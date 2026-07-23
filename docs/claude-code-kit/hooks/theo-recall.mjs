#!/usr/bin/env node
// theo-recall.mjs — SessionStart hook: auto-RECALL.
//
// Reads the hook payload, derives the project from cwd, recalls the top-K memories for
// that project, and injects them into the session via `hookSpecificOutput.additionalContext`.
//
// HARD REQUIREMENT (blueprint ADR-5, plan T3.1 failure scenario): on ANY failure or empty
// result, emit NOTHING and exit 0. A memory outage must never block a Claude Code session.

import { readInput, projectOf, post, loadEnv } from './theo-lib.mjs';

async function main() {
  const input = await readInput();
  const project = projectOf(input.cwd);
  const { userId } = loadEnv();

  // Session-separation (2026-07-23, M8 model): recall from the SESSION tier when the
  // payload carries the Claude Code session_id — the session scope reads SESSION ∪
  // GLOBAL (its own working memory plus the user's durable facts), so a fresh session
  // still gets the global space while an ongoing one also sees its own writes.
  // Exactly ONE tier key (server superRefine): sessionId wins; legacy userId pin
  // (raw REST without edge) only applies when no session id is present.
  const sessionId = typeof input.session_id === 'string' && input.session_id.length > 0
    ? input.session_id
    : undefined;
  const result = await post('/v1/recall', {
    ...(sessionId ? { sessionId } : userId ? { userId } : {}),
    query: project,
    topK: 5,
  });

  // No response (outage / error) or no results → inject nothing, exit 0.
  const items = result && Array.isArray(result.results) ? result.results : [];
  if (items.length === 0) return;

  const lines = items
    .map((it) => (it && typeof it.text === 'string' ? it.text.trim() : ''))
    .filter((t) => t.length > 0)
    .map((t) => `- ${t}`);
  if (lines.length === 0) return;

  const context = [
    `# theo-memory — recalled for project "${project}"`,
    '',
    ...lines,
  ].join('\n');

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext: context,
      },
    })
  );
}

main()
  .catch(() => {
    // Never surface an error to the session.
  })
  .finally(() => process.exit(0));
