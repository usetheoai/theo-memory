import { NextRequest, NextResponse } from "next/server";
import { getMemory } from "@/lib/memory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const userId = url.searchParams.get("userId");
  const query = url.searchParams.get("q") ?? "";
  const limit = Number.parseInt(url.searchParams.get("limit") ?? "20", 10);

  if (userId === null || userId === "") {
    return NextResponse.json({ error: "userId required" }, { status: 400 });
  }

  const memory = await getMemory();
  const scoped = memory.user(userId);
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
