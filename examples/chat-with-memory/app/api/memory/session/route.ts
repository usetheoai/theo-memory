/**
 * GET /api/memory/session?sessionId=...&q=...&limit=20
 *
 * Returns memories scoped to a Session (the current conversation).
 * Demonstrates the Session tier (mid-lived) vs the User tier (long-lived).
 */
import { NextRequest, NextResponse } from "next/server";
import { getMemory } from "@/lib/memory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const sessionId = url.searchParams.get("sessionId");
  const query = url.searchParams.get("q") ?? "";
  const limit = Number.parseInt(url.searchParams.get("limit") ?? "20", 10);

  if (sessionId === null || sessionId === "") {
    return NextResponse.json({ error: "sessionId required" }, { status: 400 });
  }

  const memory = await getMemory();
  const scoped = memory.session(sessionId);
  const items =
    query === ""
      ? await scoped.getAll({ topK: limit })
      : await scoped.recall(query, { topK: limit });

  return NextResponse.json({
    items: items.map((it) => ({
      id: it.id,
      text: it.text,
      score: "score" in it ? it.score : undefined,
      createdAt: it.createdAt,
    })),
  });
}
