/**
 * GET /api/memory/eviction-status?userId=...
 *
 * Eviction state for the user scope + active/soft-deleted row counts. Consumed
 * by EvictionTab UI. In-memory backend returns zeros (no t_invalid concept).
 * EC-5 absorption: pgPool query wrapped in try/catch → 500 JSON on failure.
 * Migrated from app/api/memory/eviction-status/route.ts (T2.1 of
 * examples-theokit-chat-migration).
 *
 * @see .claude/knowledge-base/plans/examples-chat-with-memory-v0-4b-expansion-plan.md § T1.2 + T1.3 § H1
 */
import { defineRoute } from "theokit/server";
import { getSingleton } from "@/lib/memory";

export const GET = defineRoute({
  handler: async ({ request }) => {
    const url = new URL(request.url);
    const userId = url.searchParams.get("userId");
    if (userId === null || userId === "") {
      return Response.json({ error: "userId required" }, { status: 400 });
    }

    const singleton = await getSingleton();
    let activeCount = 0;
    let softDeletedCount = 0;
    if (singleton.pgPool !== null) {
      try {
        const result = await singleton.pgPool.query<{
          active: string;
          soft_deleted: string;
        }>(
          `SELECT
             COUNT(*) FILTER (WHERE t_invalid IS NULL)::text AS active,
             COUNT(*) FILTER (WHERE t_invalid IS NOT NULL)::text AS soft_deleted
           FROM memories
           WHERE user_id = $1`,
          [userId],
        );
        activeCount = Number.parseInt(result.rows[0]?.active ?? "0", 10);
        softDeletedCount = Number.parseInt(result.rows[0]?.soft_deleted ?? "0", 10);
      } catch (err) {
        return Response.json(
          {
            error: "eviction-status query failed",
            detail: err instanceof Error ? err.message : String(err),
          },
          { status: 500 },
        );
      }
    }

    return Response.json({
      enabled: singleton.eviction.enabled,
      trigger: singleton.eviction.trigger,
      maxMemoriesPerScope: singleton.eviction.maxMemoriesPerScope,
      activeCount,
      softDeletedCount,
    });
  },
});
