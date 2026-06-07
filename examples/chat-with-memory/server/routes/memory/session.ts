/**
 * GET /api/memory/session?sessionId=...&q=...&limit=N
 *
 * Returns memories scoped to the Session tier. Migrated from
 * app/api/memory/session/route.ts (T2.1 of examples-theokit-chat-migration).
 */
import { defineRoute } from "theokit/server";
import { getMemory } from "../../../lib/memory";

export const GET = defineRoute({
  handler: async ({ request }) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    const sessionId = url.searchParams.get("sessionId");
    const query = url.searchParams.get("q") ?? "";
    const limit = Number.parseInt(url.searchParams.get("limit") ?? "20", 10);

    if (sessionId === null || sessionId === "") {
      return Response.json({ error: "sessionId required" }, { status: 400 });
    }

    const memory = await getMemory();
    const scoped = memory.session(sessionId);
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
