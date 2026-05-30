/**
 * POST /api/skills/consolidate { repoId }
 *
 * Triggers the 4-phase consolidate orchestrator (Orient → Gather →
 * Consolidate → Report) — produces derived skills with `derivedFrom`
 * provenance and marks sources as `superseded_by` the new derived row
 * (EC-2 atomicity per v0.6.1 T1.1).
 */
import { NextRequest, NextResponse } from "next/server";
import { getMemory } from "@/lib/memory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ConsolidateBody {
  repoId?: string;
}

export async function POST(req: NextRequest) {
  let body: ConsolidateBody;
  try {
    body = (await req.json()) as ConsolidateBody;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const { repoId } = body;
  if (typeof repoId !== "string" || repoId === "") {
    return NextResponse.json({ error: "repoId required" }, { status: 400 });
  }

  const memory = await getMemory();
  try {
    const result = await memory.skills(repoId).consolidate();
    return NextResponse.json({
      sourceClustersCount: result.sourceClusters.length,
      derivedSkillsCount: result.derivedSkills.length,
      supersededIds: result.supersededIds,
      durationMs: result.durationMs,
      derivedSkills: result.derivedSkills.map((s) => ({
        id: s.id,
        description: s.description,
        derivedFrom: s.derivedFrom,
        supersededBy: s.supersededBy,
        createdAt: s.createdAt,
      })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
