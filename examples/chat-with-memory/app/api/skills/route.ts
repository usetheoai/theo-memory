/**
 * GET    /api/skills?repoId=...&q=...&limit=20    → recall (semantic) or list
 * POST   /api/skills { repoId, code, description, codeLanguage } → add()
 *
 * Demonstrates the v0.6 RepoScope (4th Scope tier, ADR-0010): each repoId
 * is an isolated skill library scoped to a code-graph entity, NOT a user
 * or session. `description` is the canonical identity (hashFact-derived
 * per v0.6.1 T1.2); same description + different code COLLIDE on UNIQUE
 * (see SkillDraft JSDoc).
 */
import { NextRequest, NextResponse } from "next/server";
import { getMemory } from "@/lib/memory";
import type { SkillDraft } from "@usetheo/memory/contract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const repoId = url.searchParams.get("repoId");
  const query = url.searchParams.get("q") ?? "";
  const limit = Number.parseInt(url.searchParams.get("limit") ?? "20", 10);

  if (repoId === null || repoId === "") {
    return NextResponse.json({ error: "repoId required" }, { status: 400 });
  }

  const memory = await getMemory();
  const scoped = memory.skills(repoId);
  const items =
    query === ""
      ? // No public list verb on ScopedSkillMemory yet — empty-query path uses
        // recall against the empty string which the embedder accepts as "no
        // semantic preference" (returns by storage order). For the demo this
        // is fine; a v0.7 list() helper would land cleaner.
        await scoped.recall("retry helper code skill snippet", { topK: limit })
      : await scoped.recall(query, { topK: limit });

  return NextResponse.json({
    items: items.map((s) => ({
      id: s.id,
      description: s.description,
      code: s.code,
      codeLanguage: s.codeLanguage,
      derivedFrom: s.derivedFrom,
      supersededBy: s.supersededBy,
      createdAt: s.createdAt,
      score: s.score,
    })),
  });
}

interface AddSkillBody {
  repoId?: string;
  code?: string;
  description?: string;
  codeLanguage?: "typescript" | "javascript";
}

export async function POST(req: NextRequest) {
  let body: AddSkillBody;
  try {
    body = (await req.json()) as AddSkillBody;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const { repoId, code, description, codeLanguage } = body;
  if (typeof repoId !== "string" || repoId === "") {
    return NextResponse.json({ error: "repoId required" }, { status: 400 });
  }
  if (typeof code !== "string" || code === "") {
    return NextResponse.json({ error: "code required" }, { status: 400 });
  }
  if (typeof description !== "string" || description.trim() === "") {
    return NextResponse.json({ error: "description required" }, { status: 400 });
  }
  const lang = codeLanguage ?? "typescript";
  if (lang !== "typescript" && lang !== "javascript") {
    return NextResponse.json(
      { error: "codeLanguage must be typescript|javascript" },
      { status: 400 },
    );
  }

  const memory = await getMemory();
  const draft: SkillDraft = { code, description, codeLanguage: lang };

  try {
    const skill = await memory.skills(repoId).add(draft);
    return NextResponse.json({
      skill: {
        id: skill.id,
        description: skill.description,
        code: skill.code,
        codeLanguage: skill.codeLanguage,
        derivedFrom: skill.derivedFrom,
        supersededBy: skill.supersededBy,
        createdAt: skill.createdAt,
      },
    });
  } catch (err) {
    // Most likely the hashFact(description) collision per the SkillDraft
    // invariant (v0.6.1 T1.2 / F7). Surface with a structured 409 so the UI
    // can prompt the consumer to revise the description.
    const message = err instanceof Error ? err.message : String(err);
    const isDup =
      message.includes("memories_hash_unique_idx") ||
      message.includes("duplicate key") ||
      message.toLowerCase().includes("unique");
    if (isDup) {
      return NextResponse.json(
        {
          error:
            "A skill with this description already exists (hash collision). Revise the description and retry.",
        },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
