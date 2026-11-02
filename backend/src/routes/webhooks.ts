
import type { FastifyInstance } from "fastify";
import { createHash } from "node:crypto";
import { Redis } from "ioredis";
import { requireApiKey } from "../middleware/auth.js";
import { isPublicHttpsUrl } from "../services/webhook.js"; // REG-19
import { encryptSecret, decryptSecret } from "../services/secret-box.js";
import { setSubscriberResolver } from "../services/webhook.js";
import { isValidAddress } from "../config.js";
import { WebhookSubscribeSchema, WebhookUnsubscribeSchema } from "../schemas/index.js";

/**
 * Subscriber storage is Redis-backed when a healthy Redis connection exists
 * (the Docker/local deployment), and falls back to a process-local in-memory
 * set otherwise (serverless deployments without Redis). Without the fallback
 * every webhook route returned 503 on Vercel, so even the demo subscription
 * flow failed.
 *
 * The in-memory store is per-instance and non-durable — exactly the documented
 * trade-off of running without Redis. Redis stays authoritative whenever it is
 * configured and ready.
 */
export async function registerWebhookRoutes(app: FastifyInstance, redis: Redis | null): Promise<void> {
  const redisReady = (): boolean => redis?.status === "ready";
  const useRedis = (): boolean => Boolean(redis) && redisReady();

  /** Fallback store: key -> raw JSON records, mirroring Redis sets. */
  const memoryStore = new Map<string, Set<string>>();

  async function storeAdd(key: string, value: string): Promise<void> {
    if (useRedis()) {
      await redis!.sadd(key, value);
      return;
    }
    let set = memoryStore.get(key);
    if (!set) {
      set = new Set();
      memoryStore.set(key, set);
    }
    set.add(value);
  }

  async function storeMembers(key: string): Promise<string[]> {
    if (useRedis()) return redis!.smembers(key);
    return Array.from(memoryStore.get(key) ?? []);
  }

  async function storeRemove(key: string, value: string): Promise<number> {
    if (useRedis()) return redis!.srem(key, value);
    const set = memoryStore.get(key);
    if (!set) return 0;
    return set.delete(value) ? 1 : 0;
  }

  async function storeKeys(): Promise<string[]> {
    if (useRedis()) {
      // REG-20: SCAN not KEYS (blocking O(N) on live Redis)
      const keys: string[] = [];
      let cursor = "0";
      do {
        const [nextCursor, batch] = await redis!.scan(cursor, "MATCH", "subscribers:*", "COUNT", 100);
        cursor = nextCursor;
        keys.push(...batch);
      } while (cursor !== "0");
      return keys;
    }
    return Array.from(memoryStore.keys());
  }

  app.post("/v1/webhooks/subscribe", {
    preHandler: requireApiKey,
    config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
    schema: { body: WebhookSubscribeSchema },
  }, async (request, reply) => {
    const { address, url, secret, events } = request.body as { address: string; url: string; secret?: string; events?: string[] };
    if (!address || !url) {
      return reply.status(400).send({ error: "address and url are required" });
    }
    if (!isValidAddress(address)) {
      return reply.status(400).send({ error: "Invalid address format" });
    }
    try { new URL(url); } catch { return reply.status(400).send({ error: "Invalid url format" }); }
    if (!isPublicHttpsUrl(url)) {
      return reply.status(400).send({ error: "URL must be public HTTPS (no localhost/private)" });
    }
    const eventList = events && events.length ? events : ["*"];
    let stored: string;
    try {
      stored = JSON.stringify({
        url, address,
        secret: encryptSecret(secret ?? "", () => app.log.warn("QTRUST_WEBHOOK_ENC_KEY not set — webhook secrets are stored UNENCRYPTED")),
      });
      for (const event of eventList) {
        const key = event === "*" ? "subscribers:*" : `subscribers:${event}`;
        await storeAdd(key, stored);
      }
    } catch (err) {
      request.log.warn({ err }, "Webhook subscription storage failed");
      return reply.status(503).send({ error: "Webhook subscription storage unavailable" });
    }
    return {
      subscribed: true,
      storage: useRedis() ? "redis" : "memory",
      subscriber: { address, url, events: eventList, secret: secret ? "•••" : "" },
    };
  });

  app.post("/v1/webhooks/unsubscribe", {
    preHandler: requireApiKey,
    config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
    schema: { body: WebhookUnsubscribeSchema },
  }, async (request, reply) => {
    const { address, url, events } = request.body as { address: string; url: string; events?: string[] };
    if (!address || !url) {
      return reply.status(400).send({ error: "address and url are required" });
    }
    // A subscription is stored under one key per event (`subscribers:<event>`),
    // so an unsubscribe that omits `events` must sweep every bucket. Touching
    // only the wildcard key left the real subscription behind and returned
    // 200 with removed=0 — a silent no-op for any caller that did not echo the
    // exact event list back.
    let keys: string[];
    try {
      keys = events && events.length
        ? events.map((event) => (event === "*" ? "subscribers:*" : `subscribers:${event}`))
        : await storeKeys();
    } catch (err) {
      request.log.warn({ err }, "Webhook unsubscription storage failed");
      return reply.status(503).send({ error: "Webhook storage unavailable" });
    }
    let removed = 0;
    try {
      for (const key of keys) {
        const records = await storeMembers(key);
        for (const raw of records) {
          try {
            const parsed = JSON.parse(raw) as { url?: string; address?: string };
            if (parsed.url === url && parsed.address?.toLowerCase() === address.toLowerCase()) {
              removed += await storeRemove(key, raw);
            }
          } catch { continue; }
        }
      }
    } catch (err) {
      request.log.warn({ err }, "Webhook unsubscription storage failed");
      return reply.status(503).send({ error: "Webhook storage unavailable" });
    }
    return { unsubscribed: removed > 0, removed };
  });

  app.get("/v1/webhooks/subscribers", { preHandler: requireApiKey }, async () => {
    let keys: string[] = [];
    try {
      keys = await storeKeys();
    } catch (err) {
      app.log.warn({ err }, "Webhook subscriber listing failed");
      return { subscribers: [], error: "Webhook storage unavailable" };
    }
    const byId = new Map<string, { id: string; url: string; address: string; events: string[] }>();
    for (const key of keys) {
      const event = key.replace("subscribers:", "");
      const records = await storeMembers(key);
      for (const raw of records) {
        let url = "";
        let address = "";
        try {
          const parsed = JSON.parse(raw) as { url?: string; address?: string; secret?: string };
          url = typeof parsed.url === "string" ? parsed.url : "";
          address = typeof parsed.address === "string" ? parsed.address : "";
        } catch { continue; }
        if (!url) continue;
        const id = createHash("sha256").update(url).digest("hex").slice(0, 16);
        const existing = byId.get(id);
        if (existing) {
          if (!existing.events.includes(event)) existing.events.push(event);
        } else {
          byId.set(id, { id, url, address, events: [event] });
        }
      }
    }
    return { subscribers: Array.from(byId.values()), storage: useRedis() ? "redis" : "memory" };
  });

  // Delivery fan-out consults the same store the routes write to, so
  // subscriptions work with or without Redis.
  setSubscriberResolver(async (eventType: string) => {
    const keys = [`subscribers:${eventType}`, "subscribers:*"];
    const seen = new Set<string>();
    const out: Array<{ url: string; secret?: string }> = [];
    for (const key of keys) {
      const records = await storeMembers(key);
      for (const raw of records) {
        try {
          const parsed = JSON.parse(raw) as { url?: string; address?: string; secret?: string };
          if (!parsed.url || seen.has(`${parsed.address ?? ""}|${parsed.url}`)) continue;
          seen.add(`${parsed.address ?? ""}|${parsed.url}`);
          let secret: string | undefined;
          try { secret = parsed.secret ? decryptSecret(parsed.secret) : undefined; } catch { console.warn(`Webhook subscriber ${parsed.url}: undecryptable secret — delivering unsigned`); }
          out.push({ url: parsed.url, secret });
        } catch { continue; }
      }
    }
    return out;
  });
}
