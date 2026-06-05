/**
 * GET    /api/skills?repoId=...&q=...&limit=N → recall (semantic) or list
 * POST   /api/skills { repoId, code, description, codeLanguage } → add()
 *
 * v0.6 RepoScope (4th Scope tier per ADR-0010). Migrated from
 * app/api/skills/route.ts (T2.1 of examples-theokit-chat-migration).
 */
import { defineRoute } from "theokit/server";
import { getMemory } from "@/lib/memory";
import type { SkillDraft } from "@usetheo/memory/contract";

export const GET = defineRoute({
  handler: async ({ request }) => {
    const url = new URL(request.url);
    const repoId = url.searchParams.get("repoId");
    const query = url.searchParams.get("q") ?? "";
    const limit = Number.parseInt(url.searchParams.get("limit") ?? "20", 10);

    if (repoId === null || repoId === "") {
      return Response.json({ error: "repoId required" }, { status: 400 });
    }

    const memory = await getMemory();
    const scoped = memory.skills(repoId);
    const items =
      query === ""
        ? // No public list verb on ScopedSkillMemory yet — empty-query path uses
          // recall against a generic phrase so the demo can show "all" via the
          // semantic neighbor floor. v0.7 list() helper would land cleaner.
          await scoped.recall("retry helper code skill snippet", { topK: limit })
        : await scoped.recall(query, { topK: limit });

    return Response.json({
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
  },
});

interface AddSkillBody {
  repoId?: string;
  code?: string;
  description?: string;
  codeLanguage?: "typescript" | "javascript";
}

export const POST = defineRoute({
  handler: async ({ request }) => {
    let body: AddSkillBody;
    try {
      body = (await request.json()) as AddSkillBody;
    } catch {
      return Response.json({ error: "invalid json" }, { status: 400 });
    }
    const { repoId, code, description, codeLanguage } = body;
    if (typeof repoId !== "string" || repoId === "") {
      return Response.json({ error: "repoId required" }, { status: 400 });
    }
    if (typeof code !== "string" || code === "") {
      return Response.json({ error: "code required" }, { status: 400 });
    }
    if (typeof description !== "string" || description.trim() === "") {
      return Response.json({ error: "description required" }, { status: 400 });
    }
    const lang = codeLanguage ?? "typescript";
    if (lang !== "typescript" && lang !== "javascript") {
      return Response.json(
        { error: "codeLanguage must be typescript|javascript" },
        { status: 400 },
      );
    }

    const memory = await getMemory();
    const draft: SkillDraft = { code, description, codeLanguage: lang };

    try {
      const skill = await memory.skills(repoId).add(draft);
      return Response.json({
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
      const message = err instanceof Error ? err.message : String(err);
      const isDup =
        message.includes("memories_hash_unique_idx") ||
        message.includes("duplicate key") ||
        message.toLowerCase().includes("unique");
      if (isDup) {
        return Response.json(
          {
            error:
              "A skill with this description already exists (hash collision). Revise the description and retry.",
          },
          { status: 409 },
        );
      }
      return Response.json({ error: message }, { status: 500 });
    }
  },
});
