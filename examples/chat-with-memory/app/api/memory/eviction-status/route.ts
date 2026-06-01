/**
 * GET /api/memory/eviction-status?userId=...
 *
 * Surfaces the demo singleton's eviction state (T1.1) PLUS the count of
 * active + soft-deleted rows for the queried user scope. Consumed by the
 * `EvictionTab` UI (T1.3) to render runtime stats.
 *
 * Response shape (locked by plan §216 + T1.2 + T1.3 §342-344):
 *   {
 *     enabled: boolean,
 *     trigger: 'capacity' | 'time' | null,
 *     maxMemoriesPerScope: number | null,
 *     activeCount: number,        // `t_invalid IS NULL` (T1.3 § H1 scenario)
 *     softDeletedCount: number,   // `t_invalid IS NOT NULL`
 *   }
 *
 * EC-5 absorption: pgPool query is wrapped in try/catch returning 500 JSON
 * rather than crashing the dev server. In-memory backend returns zeros (no
 * `t_invalid` concept exists; per T7.1 BREAKING the in-memory adapter does
 * not implement soft-delete).
 *
 * @see .claude/knowledge-base/plans/examples-chat-with-memory-v0-4b-expansion-plan.md § T1.2 + T1.3 § H1
 * @see .claude/knowledge-base/reviews/examples-chat-with-memory-v0-4b-expansion-edge-cases-2026-05-31.md EC-5
 */
import { NextRequest, NextResponse } from "next/server";
import { getSingleton } from "@/lib/memory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const url = new URL(req.url);
  const userId = url.searchParams.get("userId");
  if (userId === null || userId === "") {
    return NextResponse.json({ error: "userId required" }, { status: 400 });
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
      return NextResponse.json(
        {
          error: "eviction-status query failed",
          detail: err instanceof Error ? err.message : String(err),
        },
        { status: 500 },
      );
    }
  }

  return NextResponse.json({
    enabled: singleton.eviction.enabled,
    trigger: singleton.eviction.trigger,
    maxMemoriesPerScope: singleton.eviction.maxMemoriesPerScope,
    activeCount,
    softDeletedCount,
  });
}
