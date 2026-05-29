/**
 * theo-memory integration glue for the @usetheo/sdk Agent.
 *
 * Two public-API levers wire theo-memory into the agent loop:
 *
 *   1. `systemPromptResolver(ctx)` — called by the SDK on every `agent.send()`.
 *      We recall the top-K relevant facts for this user and inject them as a
 *      `<memory-context>` block ahead of the model's instructions.
 *
 *   2. `rememberTurn({prompt, reply})` — invoked AFTER `run.wait()` in the
 *      chat route; writes the user message + assistant reply to theo-memory.
 *      Triggers `reflect()` in the background after N writes (v0.4a
 *      consolidation pipeline).
 *
 * The SDK's `kind: "memory"` plugin path is intentionally not used because
 * its `MemoryProviderFactory` type alias is not exposed in @usetheo/sdk
 * v1.3.0's published .d.ts. This module sticks to surfaces that are stable
 * + fully typed.
 */
import "server-only";
import type { SystemPromptContext } from "@usetheo/sdk";
import type { MemoryItemWithScore } from "@usetheo/memory/contract";
import { getMemory } from "./memory";

const DEFAULT_RECALL_K = 5;
const REFLECTION_THRESHOLD = (() => {
  const raw = process.env.THEOMEM_REFLECTION_THRESHOLD ?? "10";
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 10;
})();

const writeCounts = new Map<string, number>();

const BASE_SYSTEM_PROMPT = [
  "You are a helpful, concise assistant powered by Theokit.",
  "You have access to a persistent memory layer (TheMemory) that remembers facts about the user across sessions.",
  "When the <memory-context> block is present, treat each fact as established prior knowledge about THIS user — use it naturally, do not restate it verbatim, and do not pretend you do not know it.",
  "Never invent facts and never store the memory as conversation. Just answer the user.",
].join("\n");

function formatMemoryBlock(facts: readonly MemoryItemWithScore[]): string {
  if (facts.length === 0) return "";
  const lines = facts.map((f, i) => `${i + 1}. ${f.text}`).join("\n");
  return `\n\n<memory-context>\n${lines}\n</memory-context>`;
}

export function createSystemPromptResolver(opts: { userId: string }) {
  const { userId } = opts;
  return async (ctx: SystemPromptContext): Promise<string> => {
    const memory = await getMemory();
    const facts = await memory.user(userId).recall(ctx.userMessage, {
      topK: DEFAULT_RECALL_K,
    });
    return `${BASE_SYSTEM_PROMPT}${formatMemoryBlock(facts)}`;
  };
}

export async function rememberTurn(opts: {
  userId: string;
  prompt: string;
  reply: string;
}): Promise<void> {
  const memory = await getMemory();
  const scoped = memory.user(opts.userId);
  const conversation = `User: ${opts.prompt}\nAssistant: ${opts.reply}`;
  await scoped.remember(conversation);

  if (REFLECTION_THRESHOLD === 0) return;
  const prev = writeCounts.get(opts.userId) ?? 0;
  const next = prev + 1;
  writeCounts.set(opts.userId, next);
  if (next >= REFLECTION_THRESHOLD) {
    writeCounts.set(opts.userId, 0);
    scoped.reflect().catch((err) => {
      // eslint-disable-next-line no-console
      console.warn("[theomemory] reflect() failed:", err);
    });
  }
}
