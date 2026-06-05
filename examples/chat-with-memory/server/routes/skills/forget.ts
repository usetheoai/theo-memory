/**
 * POST /api/skills/forget { repoId, skillId }
 *
 * Scope-isolated forget (v0.6.1 T4.1 / EC-2): rejects when skillId belongs
 * to a different repoId OR is not a skill. All rejections surface the SAME
 * MemoryNotFound to prevent information leak. Migrated from
 * app/api/skills/forget/route.ts (T2.1 of examples-theokit-chat-migration).
 */
import { defineRoute } from "theokit/server";
import { getMemory } from "../../../lib/memory";

interface ForgetSkillBody {
  repoId?: string;
  skillId?: string;
}

export const POST = defineRoute({
  handler: async ({ request }) => {
    let body: ForgetSkillBody;
    try {
      body = (await request.json()) as ForgetSkillBody;
    } catch {
      return Response.json({ error: "invalid json" }, { status: 400 });
    }
    const { repoId, skillId } = body;
    if (typeof repoId !== "string" || repoId === "") {
      return Response.json({ error: "repoId required" }, { status: 400 });
    }
    if (typeof skillId !== "string" || skillId === "") {
      return Response.json({ error: "skillId required" }, { status: 400 });
    }

    const memory = await getMemory();
    try {
      await memory.skills(repoId).forget(skillId);
      return Response.json({ ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.toLowerCase().includes("not found")) {
        return Response.json({ error: message }, { status: 404 });
      }
      return Response.json({ error: message }, { status: 500 });
    }
  },
});
