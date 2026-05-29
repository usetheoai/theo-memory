import { NextRequest, NextResponse } from "next/server";
import { getMemory } from "@/lib/memory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ReflectRequest {
  userId: string;
}

export async function POST(req: NextRequest) {
  let body: ReflectRequest;
  try {
    body = (await req.json()) as ReflectRequest;
  } catch {
    return NextResponse.json({ error: "invalid json body" }, { status: 400 });
  }
  if (typeof body.userId !== "string" || body.userId === "") {
    return NextResponse.json({ error: "userId required" }, { status: 400 });
  }

  const memory = await getMemory();
  const result = await memory.user(body.userId).reflect();
  return NextResponse.json({
    derivedMemoriesCreated: result.derivedMemoriesCreated,
    reason: result.reason,
  });
}
