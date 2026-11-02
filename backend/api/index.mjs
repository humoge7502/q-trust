import { buildServer } from "../dist/server.js";

// One Fastify instance per warm serverless container.
let appPromise;

// Vercel's default body parser consumes the request stream, which breaks
// Fastify's own JSON parsing. Disable it and feed Fastify the raw request.
export const config = { api: { bodyParser: false }, maxDuration: 60 };

export default async function handler(req, res) {
  if (!appPromise) {
    appPromise = buildServer().then(async (app) => {
      await app.ready();
      return app;
    });
  }

  const app = await appPromise;

  // vercel.json rewrites /api/<path> to /api/index?__p=<path>; rebuild the
  // original URL (path + surviving query string) for Fastify's router.
  const parsed = new URL(typeof req.url === "string" ? req.url : "/", "http://internal");
  const captured = parsed.searchParams.get("__p") ?? "";
  parsed.searchParams.delete("__p");
  if (parsed.searchParams.get("path") === captured) {
    parsed.searchParams.delete("path");
  }
  const search = parsed.searchParams.toString();
  req.url = `/${captured}${search ? `?${search}` : ""}`;

  app.server.emit("request", req, res);
}
