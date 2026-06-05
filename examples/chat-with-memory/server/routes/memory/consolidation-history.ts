/**
 * GET /api/memory/consolidation-history?userId=...&limit=N&offset=M
 *
 * v0.7 consolidation_history audit rows for the given user scope. Server-side
 * paginates (default 50, max 200) ORDER BY created_at DESC. INNER JOIN against
 * memories.user_id; per EC-8 rows with kept_memory_id IS NULL excluded.
 * Empty result returns 200 {rows:[], total:0}, NOT 404. Migrated from
 * app/api/memory/consolidation-history/route.ts (T2.1 of examples-theokit-chat-migration).
 *
 * @see .claude/knowledge-base/plans/examples-chat-with-memory-v0-7-distillation-plan.md § T1.2 + ADR D4 + EC-8
 */
import { defineRoute } from "theokit/server";
import { getSingleton } from "@/lib/memory";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.max(min, Math.min(max, value));
}

interface AuditRow {
  readonly id: string;
  readonly kept_memory_id: string;
  readonly kept_memory_text: string;
  readonly rejected_memory_ids: readonly string[];
  readonly reason: string;
  readonly policy_name: string;
  readonly original_episode_ids: readonly string[];
  readonly created_at: string;
}

export const GET = defineRoute({
  handler: async ({ request }) => {
    const url = new URL(request.url);
    const userId = url.searchParams.get("userId") ?? "";
    if (userId === "") {
      return Response.json({ error: "userId required" }, { status: 400 });
    }
    const limitParam = Number(url.searchParams.get("limit") ?? DEFAULT_LIMIT);
    const offsetParam = Number(url.searchParams.get("offset") ?? 0);
    const limit = clamp(limitParam, 1, MAX_LIMIT);
    const offset = clamp(offsetParam, 0, Number.MAX_SAFE_INTEGER);

    const singleton = await getSingleton();
    if (singleton.pgPool === null) {
      return Response.json({ rows: [], total: 0 });
    }
    const pool = singleton.pgPool;

    const [page, total] = await Promise.all([
      pool.query<AuditRow>(
        `SELECT ch.id, ch.kept_memory_id, m.text AS kept_memory_text,
                ch.rejected_memory_ids, ch.reason, ch.policy_name,
                ch.original_episode_ids, ch.created_at
           FROM consolidation_history ch
           INNER JOIN memories m ON ch.kept_memory_id = m.id
          WHERE m.user_id = $1
          ORDER BY ch.created_at DESC
          LIMIT $2 OFFSET $3`,
        [userId, limit, offset],
      ),
      pool.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
           FROM consolidation_history ch
           INNER JOIN memories m ON ch.kept_memory_id = m.id
          WHERE m.user_id = $1`,
        [userId],
      ),
    ]);

    return Response.json({
      rows: page.rows,
      total: Number(total.rows[0]?.count ?? "0"),
    });
  },
});
