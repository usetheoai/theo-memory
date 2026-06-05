"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Avatar,
  Button,
  ChatComposer,
  ChatMessage,
  ChatThread,
  EmptyState,
  StatTile,
  useToast,
} from "@theokit/ui";
import { Bot, Sparkles } from "lucide-react";
import { MemorySidebar } from "./memory-sidebar";

interface UIMsg {
  id: string;
  role: "user" | "assistant";
  parts: { type: "text"; text: string; state?: "streaming" | "done" }[];
}

function getPersistedId(storageKey: string, prefix: string): string {
  if (typeof window === "undefined") return "guest";
  const existing = window.localStorage.getItem(storageKey);
  if (existing !== null && existing !== "") return existing;
  const generated = `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
  window.localStorage.setItem(storageKey, generated);
  return generated;
}

interface ReflectionEvent {
  fired: boolean;
  nextThreshold: number;
  writesSinceLastReflection: number;
}

export function ChatSurface() {
  const [userId, setUserId] = useState("guest");
  const [sessionId, setSessionId] = useState("session-pending");

  useEffect(() => {
    setUserId(getPersistedId("themory-demo:userId", "user"));
    // Session is per-browser-tab — sessionStorage. New tab → new session.
    if (typeof window !== "undefined") {
      const key = "themory-demo:sessionId";
      const fromTab = window.sessionStorage.getItem(key);
      if (fromTab !== null && fromTab !== "") {
        setSessionId(fromTab);
      } else {
        const fresh = `session-${Math.random().toString(36).slice(2, 10)}`;
        window.sessionStorage.setItem(key, fresh);
        setSessionId(fresh);
      }
    }
  }, []);

  const newSession = () => {
    if (typeof window === "undefined") return;
    const fresh = `session-${Math.random().toString(36).slice(2, 10)}`;
    window.sessionStorage.setItem("themory-demo:sessionId", fresh);
    setSessionId(fresh);
    setMessages([]);
    setTurnCount(0);
    setReflectionStatus(null);
    setReloadKey((k) => k + 1);
  };

  const [messages, setMessages] = useState<UIMsg[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [turnCount, setTurnCount] = useState(0);
  const [reflectionStatus, setReflectionStatus] =
    useState<ReflectionEvent | null>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  // Surface reflection.fired as a transient toast on top of the persistent
  // Alert banner — canonical @theokit/ui toast UX via `useToast`.
  useEffect(() => {
    if (reflectionStatus?.fired === true) {
      toast({
        title: "reflect() fired",
        description: "Derived facts arriving in the User/Skills tabs.",
        variant: "info",
      });
    }
  }, [reflectionStatus?.fired, toast]);

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
        headers: {
          "Content-Type": "application/json",
          // TheoKit CSRF protection requires this header on POST per
          // theokit/server enforceCsrf. Without it, 403 CSRF_INVALID.
          "X-Theo-Action": "1",
        },
        body: JSON.stringify({ userId, sessionId, message: trimmed }),
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
            const r = (data as { reflection?: ReflectionEvent }).reflection;
            if (r !== undefined) setReflectionStatus(r);
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
            {" · "}
            session: <code className="font-mono">{sessionId}</code>
          </span>
          <Button size="sm" variant="ghost" onClick={newSession}>
            New session
          </Button>
        </header>

        <section className="grid grid-cols-4 gap-3 border-b border-border px-6 py-3">
          <StatTile label="Turns" value={String(turnCount)} />
          <StatTile label="Messages" value={String(messages.length)} />
          <StatTile label="Model" value={import.meta.env?.VITE_AGENT_MODEL_ID ?? "composer-2"} />
          <StatTile
            label="Reflection"
            value={
              reflectionStatus === null
                ? "—"
                : reflectionStatus.fired
                  ? "fired"
                  : `${reflectionStatus.writesSinceLastReflection}/${reflectionStatus.nextThreshold}`
            }
          />
        </section>
        {reflectionStatus !== null && reflectionStatus.fired && (
          <div className="border-b border-border px-6 py-2">
            <Alert
              intent="info"
              title={
                <span className="inline-flex items-center gap-2">
                  <Sparkles className="h-4 w-4" />
                  reflect() fired
                </span>
              }
              description="Derived facts arriving in the User/Skills tabs."
            />
          </div>
        )}

        <ChatThread
          ref={threadRef}
          className="flex-1 overflow-y-auto px-6 py-6"
        >
          {messages.length === 0 && (
            <EmptyState
              icon={Bot}
              title="Say hi"
              description="Tell the assistant something about you — your name, what you do, what you like. Reload the page and ask again — it will remember."
              className="mx-auto max-w-md"
            />
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

        <div className="border-t border-border px-6 py-4">
          <ChatComposer
            mode="chat"
            value={input}
            onValueChange={setInput}
            onSubmit={(value) => {
              if (value.trim() === "" || streaming) return;
              // Reuse the form-submit path; synthesize a FormEvent shim is
              // unnecessary — handleSubmit reads `input` state directly when
              // refactored. For minimal churn we set input + invoke the
              // existing handler.
              setInput(value);
              void handleSubmit(new Event("submit") as unknown as FormEvent);
            }}
            running={streaming}
            placeholder="Type a message…"
          />
          <p className="mt-2 text-xs text-muted-foreground">
            Each turn: recalled facts injected via <code>systemPrompt</code> ·
            user+assistant pair written to TheMemory · auto-reflect every N
            turns.
          </p>
        </div>
      </main>

      <MemorySidebar
        userId={userId}
        sessionId={sessionId}
        reloadKey={reloadKey}
      />
    </div>
  );
}
