"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  Avatar,
  Button,
  ChatMessage,
  ChatThread,
  StatTile,
  Textarea,
} from "@usetheo/ui";
import { Send, Bot, User } from "lucide-react";
import { MemorySidebar } from "./memory-sidebar";

interface UIMsg {
  id: string;
  role: "user" | "assistant";
  parts: { type: "text"; text: string; state?: "streaming" | "done" }[];
}

function generateUserId(): string {
  if (typeof window === "undefined") return "guest";
  const key = "themory-demo:userId";
  const existing = window.localStorage.getItem(key);
  if (existing !== null && existing !== "") return existing;
  const generated = `demo-${Math.random().toString(36).slice(2, 10)}`;
  window.localStorage.setItem(key, generated);
  return generated;
}

export function ChatSurface() {
  const [userId, setUserId] = useState("guest");
  useEffect(() => setUserId(generateUserId()), []);

  const [messages, setMessages] = useState<UIMsg[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [turnCount, setTurnCount] = useState(0);
  const threadRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when messages change.
  useEffect(() => {
    const el = threadRef.current;
    if (el !== null) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (trimmed === "" || streaming) return;

    const userMsg: UIMsg = {
      id: `u-${Date.now()}`,
      role: "user",
      parts: [{ type: "text", text: trimmed, state: "done" }],
    };
    const assistantId = `a-${Date.now()}`;
    const assistantMsg: UIMsg = {
      id: assistantId,
      role: "assistant",
      parts: [{ type: "text", text: "", state: "streaming" }],
    };

    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setInput("");
    setStreaming(true);

    try {
      const resp = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, message: trimmed }),
      });
      if (resp.body === null) throw new Error("no response body");

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      // Minimal SSE frame parser: split on blank line; each frame has
      // "event: <name>\ndata: <json>\n".
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";
        for (const frame of frames) {
          const lines = frame.split("\n");
          const eventLine = lines.find((l) => l.startsWith("event: "));
          const dataLine = lines.find((l) => l.startsWith("data: "));
          if (eventLine === undefined || dataLine === undefined) continue;
          const event = eventLine.slice("event: ".length);
          const data = JSON.parse(dataLine.slice("data: ".length)) as Record<
            string,
            unknown
          >;
          if (event === "delta" && typeof data.text === "string") {
            const piece = data.text;
            setMessages((prev) =>
              prev.map((m) => {
                if (m.id !== assistantId) return m;
                const head = m.parts[0]!;
                return {
                  ...m,
                  parts: [
                    {
                      type: "text",
                      text: head.text + piece,
                      state: "streaming",
                    },
                  ],
                };
              }),
            );
          } else if (event === "done") {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? {
                      ...m,
                      parts: [{ ...m.parts[0]!, state: "done" }],
                    }
                  : m,
              ),
            );
          } else if (event === "error") {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? {
                      ...m,
                      parts: [
                        {
                          type: "text",
                          text: `[error: ${(data as { message: string }).message}]`,
                          state: "done",
                        },
                      ],
                    }
                  : m,
              ),
            );
          }
        }
      }
      setTurnCount((n) => n + 1);
      setReloadKey((k) => k + 1);
    } catch (err) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? {
                ...m,
                parts: [
                  {
                    type: "text",
                    text: `[network error: ${err instanceof Error ? err.message : String(err)}]`,
                    state: "done",
                  },
                ],
              }
            : m,
        ),
      );
    } finally {
      setStreaming(false);
    }
  };

  const userInitials = useMemo(
    () => userId.replace(/[^a-z0-9]/gi, "").slice(0, 2).toUpperCase() || "??",
    [userId],
  );

  return (
    <div className="flex h-screen w-full bg-background text-foreground">
      <main className="flex flex-1 flex-col">
        <header className="flex items-center gap-4 border-b border-border px-6 py-3">
          <div className="flex items-center gap-2">
            <Bot className="h-5 w-5 text-primary" />
            <h1 className="text-base font-semibold">
              TheMemory · chat that remembers
            </h1>
          </div>
          <span className="ml-auto text-xs text-muted-foreground">
            user: <code className="font-mono">{userId}</code>
          </span>
        </header>

        <section className="grid grid-cols-3 gap-3 border-b border-border px-6 py-3">
          <StatTile label="Turns" value={String(turnCount)} />
          <StatTile label="Messages" value={String(messages.length)} />
          <StatTile label="Model" value={process.env.NEXT_PUBLIC_AGENT_MODEL_ID ?? "composer-2"} />
        </section>

        <ChatThread
          ref={threadRef}
          className="flex-1 overflow-y-auto px-6 py-6"
        >
          {messages.length === 0 && (
            <div className="mx-auto max-w-md rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              Say hi. Tell the assistant something about you — your name, what
              you do, what you like. Reload the page and ask again — it will
              remember.
            </div>
          )}
          {messages.map((m) => (
            <ChatMessage
              key={m.id}
              message={m}
              variant={m.role === "user" ? "contained" : "flat"}
              avatar={
                <Avatar size="sm">
                  {m.role === "user" ? (
                    <span className="flex h-full w-full items-center justify-center text-xs font-medium">
                      {userInitials}
                    </span>
                  ) : (
                    <Bot className="h-4 w-4" />
                  )}
                </Avatar>
              }
            />
          ))}
        </ChatThread>

        <form
          onSubmit={handleSubmit}
          className="border-t border-border px-6 py-4"
        >
          <div className="flex items-end gap-3">
            <Textarea
              placeholder="Type a message…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void handleSubmit(e);
                }
              }}
              disabled={streaming}
              rows={2}
              className="flex-1 resize-none"
            />
            <Button type="submit" disabled={streaming || input.trim() === ""}>
              <Send className="mr-2 h-4 w-4" />
              {streaming ? "Sending…" : "Send"}
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Each turn: recalled facts injected via <code>systemPrompt</code> ·
            user+assistant pair written to TheMemory · auto-reflect every N
            turns.
          </p>
        </form>
      </main>

      <MemorySidebar userId={userId} reloadKey={reloadKey} />
    </div>
  );
}
