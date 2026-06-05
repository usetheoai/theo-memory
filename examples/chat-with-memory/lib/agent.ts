/**
 * Lazy-cached @theokit/sdk agent per (userId, sessionId) pair.
 *
 * The systemPromptResolver closure carries BOTH scope ids so each
 * conversation thread sees its own session-scoped recall while still
 * benefitting from the user's long-lived facts.
 */
// (post-T1.1: `import "server-only"` removed — TheoKit separates server/ from
// client/ by directory convention; the Next.js guard is no longer needed.)
import { Agent } from "@theokit/sdk";
import type { SDKAgent } from "@theokit/sdk";
import { createSystemPromptResolver } from "./theomemory-plugin";

const agentByKey = new Map<string, Promise<SDKAgent>>();

const MODEL_ID = process.env.NEXT_PUBLIC_AGENT_MODEL_ID ?? "composer-2";

function agentKey(userId: string, sessionId: string): string {
  return `${userId}::${sessionId}`;
}

export function getAgent(userId: string, sessionId: string): Promise<SDKAgent> {
  const key = agentKey(userId, sessionId);
  const existing = agentByKey.get(key);
  if (existing !== undefined) return existing;

  const created = Agent.create({
    apiKey: process.env.THEOKIT_API_KEY,
    model: { id: MODEL_ID },
    name: `themory-demo-${userId}-${sessionId}`,
    local: { cwd: process.cwd() },
    systemPrompt: createSystemPromptResolver({ userId, sessionId }),
  });

  agentByKey.set(key, created);
  return created;
}
