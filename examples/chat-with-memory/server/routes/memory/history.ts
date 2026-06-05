/**
 * GET /api/memory/history?memoryId=...
 *
 * Audit-trail entries for a single memory id via memory.history(memoryId).
 * Empty array when no HistoryManager wired (in-memory backend). Migrated
 * from app/api/memory/history/route.ts (T2.1 of examples-theokit-chat-migration).
 *
 * @see ADR-0003 + ADR-0004 history() verb
 */
import { defineRoute } from "theokit/server";
import { getMemory } from "../../../lib/memory";

export const GET = defineRoute({
  handler: async ({ request }) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    const memoryId = url.searchParams.get("memoryId");

    if (memoryId === null || memoryId === "") {
      return Response.json({ error: "memoryId required" }, { status: 400 });
    }

    const memory = await getMemory();
    const entries = await memory.history(memoryId);

    return Response.json({
      memoryId,
      entries: entries.map((e) => ({
        action: e.action,
        at: e.at,
        previousValue: e.previousValue,
        newValue: e.newValue,
      })),
    });
  },
});
