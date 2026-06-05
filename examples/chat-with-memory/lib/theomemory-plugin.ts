/**
 * theo-memory integration glue for the @usetheo/sdk Agent.
 *
 * Two public-API levers wire theo-memory into the agent loop:
 *
 *   1. `systemPromptResolver(ctx)` — called by the SDK on every `agent.send()`.
 *      Recalls the top-K relevant facts from BOTH the User scope AND the
 *      current Session scope (v0.6.1 demo expansion) and injects them
 *      as a `<memory-context>` block ahead of the model's instructions.
 *
 *   2. `rememberTurn({prompt, reply})` — invoked AFTER `run.wait()`; writes
 *      the user message + assistant reply to BOTH the User scope (long-lived,
 *      cross-session) AND the Session scope (mid-lived, this conversation).
 *      Triggers `reflect()` in the background after N writes per user.
 */
// (post-T1.1: `import "server-only"` removed — TheoKit separates server/ from
// client/ by directory convention; the Next.js guard is no longer needed.)
import type { SystemPromptContext } from "@usetheo/sdk";
import type { MemoryItemWithScore } from "@usetheo/memory/contract";
import { getMemory } from "./memory";

const DEFAULT_RECALL_K = 5;
const REFLECTION_THRESHOLD = (() => {
  const raw = process.env.THEOMEM_REFLECTION_THRESHOLD ?? "10";
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 10;
})();

declare global {
  // eslint-disable-next-line no-var
  var _themory_demo_writeCounts: Map<string, number> | undefined;
}

function getWriteCounts(): Map<string, number> {
  return (globalThis._themory_demo_writeCounts ??= new Map<string, number>());
}

const BASE_SYSTEM_PROMPT = [
  "You are a helpful, concise assistant powered by Theokit.",
  "You have access to a persistent memory layer (TheMemory) that remembers facts about the user across sessions.",
  "The <memory-context> block carries two layers: <user-facts> (cross-session knowledge about this user) and <session-facts> (recall from THIS conversation only).",
  "Treat both as established prior knowledge — use naturally, do not restate verbatim.",
  "Never invent facts and never store the memory as conversation. Just answer the user.",
].join("\n");

function formatBlock(label: string, facts: readonly MemoryItemWithScore[]): string {
  if (facts.length === 0) return "";
  const lines = facts.map((f, i) => `${i + 1}. ${f.text}`).join("\n");
  return `\n<${label}>\n${lines}\n</${label}>`;
}

function formatMemoryContext(
  userFacts: readonly MemoryItemWithScore[],
  sessionFacts: readonly MemoryItemWithScore[],
): string {
  if (userFacts.length === 0 && sessionFacts.length === 0) return "";
  return [
    "\n\n<memory-context>",
    formatBlock("user-facts", userFacts),
    formatBlock("session-facts", sessionFacts),
    "</memory-context>",
  ]
    .filter((s) => s.length > 0)
    .join("");
}

export function createSystemPromptResolver(opts: {
  userId: string;
  sessionId: string;
}) {
  const { userId, sessionId } = opts;
  return async (ctx: SystemPromptContext): Promise<string> => {
    const memory = await getMemory();
    const [userFacts, sessionFacts] = await Promise.all([
      memory.user(userId).recall(ctx.userMessage, { topK: DEFAULT_RECALL_K }),
      memory.session(sessionId).recall(ctx.userMessage, { topK: DEFAULT_RECALL_K }),
    ]);
    return `${BASE_SYSTEM_PROMPT}${formatMemoryContext(userFacts, sessionFacts)}`;
  };
}

/**
 * E2E gap fix — fallback when the @usetheo/sdk Agent run returns
 * `status: "error"` (typically: missing/invalid `THEOKIT_API_KEY` —
 * the demo accepts any random string so the constructor doesn't throw,
 * but the real auth flow rejects when the run reaches TheoCloud).
 *
 * Builds the same `<memory-context>` system prompt that the agent's
 * `systemPromptResolver` would have built, then calls OpenAILLM
 * directly (which is already wired with the operator's OpenRouter key
 * via the env-shift in `lib/memory.ts`). Returns the assistant reply
 * as a single string — the chat route streams it as one `delta` event.
 */
export async function buildReplyWithMemoryContext(opts: {
  userId: string;
  sessionId: string;
  message: string;
}): Promise<string> {
  const { userId, sessionId, message } = opts;
  const { llm, memory } = await import("./memory").then(async (m) => ({
    llm: (await m.getSingleton()).llm,
    memory: await m.getMemory(),
  }));
  const [userFacts, sessionFacts] = await Promise.all([
    memory.user(userId).recall(message, { topK: DEFAULT_RECALL_K }),
    memory.session(sessionId).recall(message, { topK: DEFAULT_RECALL_K }),
  ]);
  const systemPrompt = `${BASE_SYSTEM_PROMPT}${formatMemoryContext(userFacts, sessionFacts)}`;
  const response = await llm.generateChat([
    { role: "system", content: systemPrompt },
    { role: "user", content: message },
  ]);
  return response.content;
}

export interface ReflectionEvent {
  readonly fired: boolean;
  readonly nextThreshold: number;
  readonly writesSinceLastReflection: number;
}

export async function rememberTurn(opts: {
  userId: string;
  sessionId: string;
  prompt: string;
  reply: string;
}): Promise<ReflectionEvent> {
  const memory = await getMemory();
  const userScoped = memory.user(opts.userId);
  const sessionScoped = memory.session(opts.sessionId);
  const conversation = `User: ${opts.prompt}\nAssistant: ${opts.reply}`;
  // Persist into BOTH scopes — User for cross-session recall + Session for
  // this-conversation-only recall. Same two-stage write pipeline runs twice
  // (ADD-only per ADR-0003; the LLM extracts facts independently in each scope).
  await Promise.all([
    userScoped.remember(conversation),
    sessionScoped.remember(conversation),
  ]);

  if (REFLECTION_THRESHOLD === 0) {
    return { fired: false, nextThreshold: 0, writesSinceLastReflection: 0 };
  }
  const prev = getWriteCounts().get(opts.userId) ?? 0;
  const next = prev + 1;
  if (next >= REFLECTION_THRESHOLD) {
    getWriteCounts().set(opts.userId, 0);
    userScoped.reflect().catch((err) => {
      // eslint-disable-next-line no-console
      console.warn("[theomemory] reflect() failed:", err);
    });
    return {
      fired: true,
      nextThreshold: REFLECTION_THRESHOLD,
      writesSinceLastReflection: 0,
    };
  }
  getWriteCounts().set(opts.userId, next);
  return {
    fired: false,
    nextThreshold: REFLECTION_THRESHOLD,
    writesSinceLastReflection: next,
  };
}
