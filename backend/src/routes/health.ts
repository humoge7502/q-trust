import type { FastifyInstance } from "fastify";
import { CHAIN_ID } from "../config.js";
import { relayerAddress } from "../services/attestation.js";

export async function registerHealthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/health", async () => {
    // Liveness must remain useful before signing credentials are configured.
    // Transaction routes still fail closed on first use; exposing a null
    // relayer here avoids turning local startup probes into 500 responses.
    let relayer: string | null = null;
    try {
      relayer = relayerAddress();
    } catch {
      // Deliberately omit credential details from health responses.
    }
    return { status: "ok", chain_id: CHAIN_ID, relayer };
  });
}
