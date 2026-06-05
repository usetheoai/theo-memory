/**
 * GET /api/health — readiness probe.
 *
 * Migrated from app/api/health/route.ts (T2.1 of examples-theokit-chat-migration).
 * TheoKit URL convention: server/routes/health.ts → /api/health.
 */
import { defineRoute } from "theokit/server";

export const GET = defineRoute({
  handler: () =>
    Response.json({
      ok: true,
      name: "themory-demo-chat",
      sdk: "@usetheo/sdk@1.3.0",
      memory: "@usetheo/memory (local workspace)",
      ui: "@usetheo/ui@0.12.0",
    }),
});
