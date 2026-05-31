/**
 * GET /api/memory/eviction-status?userId=...
 *
 * Surfaces the demo singleton's eviction state (T1.1) PLUS the count of
 * soft-deleted rows for the queried user scope. Consumed by the `EvictionTab`
 * UI (T1.3) to render runtime stats.
 *
 * Response shape (locked by plan §216 + T1.2):
 *   {
 *     enabled: boolean,
 *     trigger: 'capacity' | 'time' | null,
 *     maxMemoriesPerScope: number | null,
 *     softDeletedCount: number,
 *   }
 *
 * EC-5 absorption: pgPool query is wrapped in try/catch returning 500 JSON
 * rather than crashing the dev server. In-memory backend returns 0 (no
 * `t_invalid` concept exists; per T7.1 BREAKING the in-memory adapter does
 * not implement soft-delete).
 *
 * @see .claude/knowledge-base/plans/examples-chat-with-memory-v0-4b-expansion-plan.md § T1.2
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
  let softDeletedCount = 0;
  if (singleton.pgPool !== null) {
    try {
      const result = await singleton.pgPool.query<{ count: string }>(
        "SELECT COUNT(*)::text AS count FROM memories WHERE user_id = $1 AND t_invalid IS NOT NULL",
        [userId],
      );
      softDeletedCount = Number.parseInt(result.rows[0]?.count ?? "0", 10);
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
    softDeletedCount,
  });
}
