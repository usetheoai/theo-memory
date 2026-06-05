/**
 * POST /api/memory/forget { userId, id, hard? }
 *
 * Default soft-delete via t_invalid; opt-in `{ hard: true }` for GDPR-style
 * physical row removal. Migrated from app/api/memory/forget/route.ts
 * (T2.1 of examples-theokit-chat-migration).
 *
 * @see .claude/knowledge-base/plans/examples-chat-with-memory-v0-4b-expansion-plan.md § T2.1 + ADR D2
 */
import { defineRoute } from "theokit/server";
import { getMemory } from "../../../lib/memory";

interface ForgetRequest {
  userId: string;
  id: string;
  hard?: boolean;
}

export const POST = defineRoute({
  handler: async ({ request }) => {
    let body: ForgetRequest;
    try {
      body = (await request.json()) as ForgetRequest;
    } catch {
      return Response.json({ error: "invalid json body" }, { status: 400 });
    }
    if (typeof body.userId !== "string" || body.userId === "") {
      return Response.json({ error: "userId required" }, { status: 400 });
    }
    if (typeof body.id !== "string" || body.id === "") {
      return Response.json({ error: "id required" }, { status: 400 });
    }
    if (body.hard !== undefined && typeof body.hard !== "boolean") {
      return Response.json(
        { error: "hard must be boolean if provided" },
        { status: 400 },
      );
    }

    const memory = await getMemory();
    try {
      await memory.forget(body.id, body.hard === true ? { hard: true } : undefined);
    } catch (err) {
      return Response.json(
        {
          error: "forget failed",
          detail: err instanceof Error ? err.message : String(err),
        },
        { status: 500 },
      );
    }
    return Response.json({ ok: true });
  },
});
