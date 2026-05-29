/**
 * Lazy-cached @usetheo/sdk agent per userId.
 *
 * One Agent per user so the SDK can persist its own conversation context
 * (and so the systemPromptResolver closure carries the right userId).
 */
import "server-only";
import { Agent } from "@usetheo/sdk";
import type { SDKAgent } from "@usetheo/sdk";
import { createSystemPromptResolver } from "./theomemory-plugin";

const agentByUser = new Map<string, Promise<SDKAgent>>();

const MODEL_ID = process.env.NEXT_PUBLIC_AGENT_MODEL_ID ?? "composer-2";

export function getAgent(userId: string): Promise<SDKAgent> {
  const existing = agentByUser.get(userId);
  if (existing !== undefined) return existing;

  const created = Agent.create({
    apiKey: process.env.THEOKIT_API_KEY,
    model: { id: MODEL_ID },
    name: `themory-demo-${userId}`,
    local: { cwd: process.cwd() },
    systemPrompt: createSystemPromptResolver({ userId }),
  });

  agentByUser.set(userId, created);
  return created;
}
