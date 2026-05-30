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

/**
 * Demo-side cluster threshold (per plan ADR D1, 2026-05-30).
 *
 * The core ConsolidateOptions default is 0.85 — calibrated to favor
 * precision against typical embedding pairs. Real OpenAI
 * `text-embedding-3-small` vectors for natural-language skill descriptions
 * sit around 0.65-0.78 (empirical), so the demo lowers the threshold to
 * favor recall in the showcase. Production users should leave the 0.85
 * default OR tune empirically against their corpus.
 */
const DEMO_DEFAULT_CLUSTER_THRESHOLD = 0.6;

interface ConsolidateBody {
  repoId?: string;
  clusterThreshold?: number;
}

/**
 * Fallback resolver — accepts any input shape, returns a number in [0, 1].
 * Per plan EC-5: boundary values 0 and 1 are VALID (cluster everything /
 * cluster only identical embeddings). Invalid shapes (NaN, ±Infinity,
 * negative, > 1, non-number, undefined) fall back to the demo default —
 * NOT 400-rejected.
 */
function resolveClusterThreshold(input: unknown): number {
  return typeof input === "number"
    && Number.isFinite(input)
    && input >= 0
    && input <= 1
    ? input
    : DEMO_DEFAULT_CLUSTER_THRESHOLD;
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

  const clusterThreshold = resolveClusterThreshold(body.clusterThreshold);

  const memory = await getMemory();
  try {
    const result = await memory.skills(repoId).consolidate({ clusterThreshold });
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
