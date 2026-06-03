/**
 * T1.2 — GET /api/memory/consolidation-history?userId=...&limit=N&offset=M
 *
 * Returns the v0.7 `consolidation_history` audit rows for the given user
 * scope. Server-side paginates (default limit 50, max 200 per ADR D4) +
 * ORDER BY created_at DESC. INNER JOIN against `memories.user_id` filters
 * by scope — per EC-8, rows with `kept_memory_id IS NULL` (post-GDPR
 * `forget({hard:true})`) are excluded from this view; operators can query
 * raw SQL for orphan audit rows.
 *
 * Empty result returns 200 with `{rows: [], total: 0}`, NOT 404.
 *
 * Pgvector-only: when the demo runs with `THEOMEM_PG_URI` unset
 * (`in-memory` backend), this endpoint returns `{rows: [], total: 0}` since
 * `consolidation_history` is a Postgres table.
 *
 * @see .claude/knowledge-base/plans/examples-chat-with-memory-v0-7-distillation-plan.md § T1.2 + ADR D4 + EC-8
 */
import { NextRequest, NextResponse } from "next/server";

import { getSingleton } from "@/lib/memory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get("userId") ?? "";
  if (userId === "") {
    return NextResponse.json({ error: "userId required" }, { status: 400 });
  }
  const limitParam = Number(req.nextUrl.searchParams.get("limit") ?? DEFAULT_LIMIT);
  const offsetParam = Number(req.nextUrl.searchParams.get("offset") ?? 0);
  const limit = clamp(limitParam, 1, MAX_LIMIT);
  const offset = clamp(offsetParam, 0, Number.MAX_SAFE_INTEGER);

  const singleton = await getSingleton();
  if (singleton.pgPool === null) {
    return NextResponse.json({ rows: [], total: 0 });
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

  return NextResponse.json({
    rows: page.rows,
    total: Number(total.rows[0]?.count ?? "0"),
  });
}
