/**
 * POST /api/skills/consolidate { repoId, clusterThreshold? }
 *
 * 4-phase consolidate orchestrator (Orient → Gather → Consolidate → Report).
 * Demo-side default cluster threshold 0.6 (vs core default 0.85) — favors
 * recall in the showcase per plan ADR D1 (2026-05-30). Migrated from
 * app/api/skills/consolidate/route.ts (T2.1 of examples-theokit-chat-migration).
 */
import { defineRoute } from "theokit/server";
import { getMemory } from "../../../lib/memory";

const DEMO_DEFAULT_CLUSTER_THRESHOLD = 0.6;

interface ConsolidateBody {
  repoId?: string;
  clusterThreshold?: number;
}

/**
 * Per plan EC-5: boundary values 0 and 1 are VALID. Invalid shapes (NaN,
 * ±Infinity, negative, > 1, non-number, undefined) fall back to demo
 * default — NOT 400-rejected.
 */
function resolveClusterThreshold(input: unknown): number {
  return typeof input === "number"
    && Number.isFinite(input)
    && input >= 0
    && input <= 1
    ? input
    : DEMO_DEFAULT_CLUSTER_THRESHOLD;
}

export const POST = defineRoute({
  handler: async ({ body: rawBody }) => {
    if (rawBody === undefined || rawBody === null) {
      return Response.json({ error: "invalid json" }, { status: 400 });
    }
    const body = rawBody as ConsolidateBody;
    const { repoId } = body;
    if (typeof repoId !== "string" || repoId === "") {
      return Response.json({ error: "repoId required" }, { status: 400 });
    }

    const clusterThreshold = resolveClusterThreshold(body.clusterThreshold);

    const memory = await getMemory();
    try {
      const result = await memory.skills(repoId).consolidate({ clusterThreshold });
      return Response.json({
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
      return Response.json({ error: message }, { status: 500 });
    }
  },
});
