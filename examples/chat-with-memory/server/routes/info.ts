/**
 * GET /api/info → {
 *   backend: "pgvector" | "in-memory",
 *   reflectionThreshold: N,
 *   adapterSource: "stub" | "openai" | "local-openrouter",
 *   embedderDim: 384 | 1536
 * }
 *
 * Migrated from app/api/info/route.ts (T2.1 of examples-theokit-chat-migration).
 */
import { defineRoute } from "theokit/server";
import { getSingleton } from "../../lib/memory";

export const GET = defineRoute({
  handler: async () => {
    const singleton = await getSingleton();
    const raw = process.env["THEOMEM_REFLECTION_THRESHOLD"] ?? "10";
    const n = Number.parseInt(raw, 10);
    const reflectionThreshold = Number.isFinite(n) && n >= 0 ? n : 10;
    return Response.json({
      backend: singleton.backend,
      reflectionThreshold,
      adapterSource: singleton.adapterSource,
      embedderDim: singleton.embedderDim,
    });
  },
});
