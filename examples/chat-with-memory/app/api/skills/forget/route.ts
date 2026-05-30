/**
 * POST /api/skills/forget { repoId, skillId }
 *
 * Scope-isolated forget (v0.6.1 T4.1 / EC-2): rejects when skillId belongs
 * to a different repoId OR is not a skill (kind mismatch). All rejection
 * paths surface the SAME MemoryNotFound error to prevent information leak.
 */
import { NextRequest, NextResponse } from "next/server";
import { getMemory } from "@/lib/memory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ForgetSkillBody {
  repoId?: string;
  skillId?: string;
}

export async function POST(req: NextRequest) {
  let body: ForgetSkillBody;
  try {
    body = (await req.json()) as ForgetSkillBody;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const { repoId, skillId } = body;
  if (typeof repoId !== "string" || repoId === "") {
    return NextResponse.json({ error: "repoId required" }, { status: 400 });
  }
  if (typeof skillId !== "string" || skillId === "") {
    return NextResponse.json({ error: "skillId required" }, { status: 400 });
  }

  const memory = await getMemory();
  try {
    await memory.skills(repoId).forget(skillId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.toLowerCase().includes("not found")) {
      return NextResponse.json({ error: message }, { status: 404 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
