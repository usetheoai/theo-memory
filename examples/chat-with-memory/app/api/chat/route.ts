import { NextRequest, NextResponse } from "next/server";
import { getAgent } from "@/lib/agent";
import { rememberTurn } from "@/lib/theomemory-plugin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ChatRequest {
  userId: string;
  sessionId: string;
  message: string;
}

function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function sseFrame(event: string, data: unknown): Uint8Array {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  return new TextEncoder().encode(payload);
}

export async function POST(req: NextRequest) {
  let body: ChatRequest;
  try {
    body = (await req.json()) as ChatRequest;
  } catch {
    return bad("invalid json body");
  }
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
            controller.enqueue(
              sseFrame("tool", { name: ev.name, status: ev.status }),
            );
          }
        }
        const finalResult = await run.wait();
        const reply = finalResult.result ?? assistantText;

        // Persist into BOTH User + Session scopes. Background reflect is
        // handled inside rememberTurn() when threshold crossed.
        const reflectionEvent = await rememberTurn({
          userId,
          sessionId,
          prompt: message,
          reply,
        });

        controller.enqueue(
          sseFrame("done", {
            runId: finalResult.id,
            status: finalResult.status,
            tokens: finalResult.durationMs,
            reflection: reflectionEvent,
          }),
        );
      } catch (err) {
        controller.enqueue(
          sseFrame("error", {
            message: err instanceof Error ? err.message : String(err),
          }),
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
}
