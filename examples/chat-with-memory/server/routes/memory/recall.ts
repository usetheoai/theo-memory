/**
 * GET /api/memory/recall?userId=...&q=...&limit=N
 *
 * Migrated from app/api/memory/recall/route.ts (T2.1 of examples-theokit-chat-migration).
 * Empty query path returns scope.getAll(); non-empty path returns scope.recall(q).
 */
import { defineRoute } from "theokit/server";
import { getMemory } from "@/lib/memory";

export const GET = defineRoute({
  handler: async ({ request }) => {
    const url = new URL(request.url);
    const userId = url.searchParams.get("userId");
    const query = url.searchParams.get("q") ?? "";
    const limit = Number.parseInt(url.searchParams.get("limit") ?? "20", 10);

    if (userId === null || userId === "") {
      return Response.json({ error: "userId required" }, { status: 400 });
    }

    const memory = await getMemory();
    const scoped = memory.user(userId);
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
