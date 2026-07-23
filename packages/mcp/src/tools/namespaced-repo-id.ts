/**
 * `namespacedRepoId` — subject-namespace for the MCP skill tools (#114).
 *
 * The gateway/dashboard convention (theo-cloud `namespaceRepo`, ADR D3) stores
 * every skill under `{subject}:{repoId}` so tenants sharing a workspace cannot
 * collide and the dashboard can prefix-scan a customer's skills. The MCP tools
 * stored the BARE repoId — every skill authored through the canonical agent→MCP
 * flow was invisible to the dashboard's `{subject}:%` listing.
 *
 * Contract (mirrors the BFF):
 * - Auth transport (scope carries `session.userId`) → `{userId}:{repoId}`.
 * - No-auth transport (stdio local dev, `session` null/absent) → bare repoId
 *   (backward-compatible single-user behavior).
 * - A userId containing `:` breaks concatenation injectivity → fail closed
 *   (mirrors `namespaceRepo`'s ok=false guard), never risk a cross-subject
 *   namespace collision.
 *
 * Precondition: must run inside an active `withScope(...)` block (every skill
 * handler already does — dispatch enforces it).
 */
import { getScope } from '@usetheo/memory-agent-core';

export function namespacedRepoId(repoId: string): string {
  const ctx = getScope();
  const session = 'session' in ctx ? ctx.session : undefined;
  const userId = session !== null && session !== undefined ? session.userId : undefined;
  if (typeof userId !== 'string' || userId.trim() === '') {
    return repoId;
  }
  if (userId.includes(':')) {
    throw new Error(
      `namespacedRepoId: auth userId contains ':' — cannot compose an injective '{subject}:{repoId}' namespace (subject redacted).`,
    );
  }
  return `${userId}:${repoId}`;
}
