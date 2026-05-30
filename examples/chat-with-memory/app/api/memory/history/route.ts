/**
 * GET /api/memory/history?memoryId=...
 *
 * Returns the audit-trail entries (remember / forget / reflect events) for
 * a single memory id via `memory.history(memoryId)`. Demonstrates the
 * ADD-only invariant in action: every mutation produces a new event row
 * (ADR-0003 + ADR-0004 "history()" verb).
 *
 * Note: returns an empty array when no HistoryManager is wired (the demo
 * boots without one by default — pgvector backend would add the
 * DrizzleHistoryManager wire in a future iteration). Frontend treats
 * empty as "no audit trail available" rather than an error.
 */
import { NextRequest, NextResponse } from "next/server";
import { getMemory } from "@/lib/memory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const memoryId = url.searchParams.get("memoryId");

  if (memoryId === null || memoryId === "") {
    return NextResponse.json({ error: "memoryId required" }, { status: 400 });
  }

  const memory = await getMemory();
  const entries = await memory.history(memoryId);

  return NextResponse.json({
    memoryId,
    entries: entries.map((e) => ({
      action: e.action,
      at: e.at,
      previousValue: e.previousValue,
      newValue: e.newValue,
    })),
  });
}
