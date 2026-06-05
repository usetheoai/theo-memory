/**
 * POST /api/memory/reflect { userId }
 *
 * Triggers manual reflection over user scope. Migrated from
 * app/api/memory/reflect/route.ts (T2.1 of examples-theokit-chat-migration).
 */
import { defineRoute } from "theokit/server";
import { getMemory } from "../../../lib/memory";

interface ReflectRequest {
  userId: string;
}

export const POST = defineRoute({
  handler: async ({ body: rawBody }) => {
    if (rawBody === undefined || rawBody === null) {
      return Response.json({ error: "invalid json body" }, { status: 400 });
    }
    const body = rawBody as ReflectRequest;
    if (typeof body.userId !== "string" || body.userId === "") {
      return Response.json({ error: "userId required" }, { status: 400 });
    }

    const memory = await getMemory();
    const result = await memory.user(body.userId).reflect();
    return Response.json({
      derivedMemoriesCreated: result.derivedMemoriesCreated,
      reason: result.reason,
    });
  },
});
