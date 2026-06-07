/**
 * POST /api/chat { userId, sessionId, message }
 *
 * SSE-streamed chat round-trip with memory recall + rememberTurn on completion.
 * Falls back to direct LLM (lib/theomemory-plugin) when the TheoKit Agent run
 * errors out (e.g., missing THEOKIT_API_KEY). Migrated from
 * app/api/chat/route.ts (T2.1 of examples-theokit-chat-migration).
 */
import { defineRoute } from "theokit/server";
import { getAgent } from "../../lib/agent";
import { buildReplyWithMemoryContext, rememberTurn } from "../../lib/theomemory-plugin";

interface ChatRequest {
  userId: string;
  sessionId: string;
  message: string;
}

function bad(message: string, status = 400): Response {
  return Response.json({ error: message }, { status });
}

function sseFrame(event: string, data: unknown): Uint8Array {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  return new TextEncoder().encode(payload);
}

export const POST = defineRoute({
  handler: async ({ body: rawBody }) => {
    if (rawBody === undefined || rawBody === null) {
      return bad("invalid json body");
    }
    const body = rawBody as ChatRequest;
    if (typeof body.userId !== "string" || body.userId === "") {
      return bad("userId is required");
    }
    if (typeof body.sessionId !== "string" || body.sessionId === "") {
      return bad("sessionId is required");
    }
    if (typeof body.message !== "string" || body.message === "") {
      return bad("message is required");
    }

    const { userId, sessionId, message } = body;

    const agent = await getAgent(userId, sessionId);
    const run = await agent.send(message);

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let assistantText = "";
        try {
          for await (const ev of run.stream()) {
            if (ev.type === "assistant") {
              for (const block of ev.message.content) {
                if (block.type === "text") {
                  assistantText += block.text;
                  controller.enqueue(sseFrame("delta", { text: block.text }));
                }
              }
            } else if (ev.type === "status") {
              controller.enqueue(sseFrame("status", { status: ev.status }));
            } else if (ev.type === "tool_call") {
              controller.enqueue(sseFrame("tool", { name: ev.name, status: ev.status }));
            }
          }
          const finalResult = await run.wait();
          let reply = finalResult.result ?? assistantText;
          let usedFallback = false;

          if (finalResult.status === "error" && reply === "") {
            try {
              reply = await buildReplyWithMemoryContext({ userId, sessionId, message });
              usedFallback = true;
              controller.enqueue(sseFrame("delta", { text: reply }));
            } catch (fallbackErr) {
              controller.enqueue(
                sseFrame("error", {
                  message:
                    fallbackErr instanceof Error
                      ? `Fallback LLM call failed: ${fallbackErr.message}`
                      : String(fallbackErr),
                }),
              );
            }
          }

          const reflectionEvent = await rememberTurn({
            userId,
            sessionId,
            prompt: message,
            reply,
          });

          controller.enqueue(
            sseFrame("done", {
              runId: finalResult.id,
              status: usedFallback ? "ok-fallback" : finalResult.status,
              tokens: finalResult.durationMs,
              reflection: reflectionEvent,
            }),
          );
        } catch (err) {
          controller.enqueue(
            sseFrame("error", { message: err instanceof Error ? err.message : String(err) }),
          );
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  },
});
