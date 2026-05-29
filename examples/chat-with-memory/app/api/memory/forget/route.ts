import { NextRequest, NextResponse } from "next/server";
import { getMemory } from "@/lib/memory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ForgetRequest {
  userId: string;
  id: string;
}

export async function POST(req: NextRequest) {
  let body: ForgetRequest;
  try {
    body = (await req.json()) as ForgetRequest;
  } catch {
    return NextResponse.json({ error: "invalid json body" }, { status: 400 });
  }
  if (typeof body.userId !== "string" || body.userId === "") {
    return NextResponse.json({ error: "userId required" }, { status: 400 });
  }
  if (typeof body.id !== "string" || body.id === "") {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  const memory = await getMemory();
  await memory.forget(body.id);
  return NextResponse.json({ ok: true });
}
