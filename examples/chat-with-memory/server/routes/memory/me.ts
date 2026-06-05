/**
 * GET /api/memory/me?q=...&limit=N
 *
 * T3.1 — Canonical demonstration of the @usetheo/memory/theokit subpath.
 * Auto-scopes memory from the request's session cookie (ADR D7 anon-uid)
 * via memoryFromCtx(ctx, memory) — NO explicit userId in request shape.
 *
 * Compare with /api/memory/recall which takes explicit `?userId=...` from
 * the request. The /me path is the **consumer-canonical** TheoKit pattern;
 * /recall is preserved to support the demo's multi-user impersonation UI
 * (User picker in the User tab).
 *
 * Same response shape as /api/memory/recall to keep the frontend client
 * code uniform.
 *
 * @see lib/memory.ts § memoryFromCtx re-export
 * @see server/context.ts § createContext (cookie → ctx.session.userId)
 * @see .claude/knowledge-base/plans/examples-theokit-chat-migration-plan.md § T3.1 + ADR D3
 */
import { defineRoute } from "theokit/server";
import { getMemory, memoryFromCtx } from "../../../lib/memory";

export const GET = defineRoute({
  handler: async ({ request, ctx }) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    const query = url.searchParams.get("q") ?? "";
    const limit = Number.parseInt(url.searchParams.get("limit") ?? "20", 10);

    const memory = await getMemory();
    let scoped;
    try {
      scoped = memoryFromCtx(ctx as { session: { userId: string } }, memory);
    } catch (err) {
      return Response.json(
        {
          error:
            err instanceof Error
              ? err.message
              : "memoryFromCtx failed — session cookie missing or invalid",
        },
        { status: 401 },
      );
    }

    const items =
      query === ""
        ? await scoped.getAll({ topK: limit })
        : await scoped.recall(query, { topK: limit });

    return Response.json({
      items: items.map((it) => ({
        id: it.id,
        text: it.text,
        score: "score" in it ? it.score : undefined,
        createdAt: it.createdAt,
      })),
    });
  },
});
