#!/usr/bin/env node
// theo-remember.mjs — Stop hook: auto-REMEMBER.
//
// Reads the hook payload, derives the project from cwd, and fire-and-forgets the last
// assistant message to /v1/remember (the server extracts the facts). A salience floor
// (text.length < 40) drops trivial turns to keep noise/cost down (plan Drawback 4).
//
// Exit 0 regardless — a memory outage never blocks the session (plan T3.1).

import { readInput, projectOf, postDetached, loadEnv } from './theo-lib.mjs';
import { scrubText } from './theo-scrub.mjs';

const SALIENCE_MIN_CHARS = 40;

/**
 * Pure, testable core: build the `/v1/remember` payload for a Stop-hook turn, or null
 * when the turn is below the salience floor. `attributedTo` marks the AUTHOR by hook
 * origin (M14 T1.2): the Stop summary is produced by the assistant → 'assistant'; an
 * explicit user capture → 'user'. Never inferred — the caller names it.
 *
 * @param {{ input: object, env: {userId: string}, attributedTo: 'assistant'|'user' }} deps
 * @returns {{ path: string, body: object } | null}
 */
export function buildRememberPayload({ input, env, attributedTo }) {
  const project = projectOf(input.cwd);
  // M6-SEC-01: scrub secrets BEFORE the write. The server runs LLM fact-extraction
  // (`infer: true`, set explicitly below), but a secret could still surface in an
  // extracted fact, so this client scrub is the last chance to keep it out of the store.
  const text = scrubText((input.last_assistant_message || '').trim());
  // Salience floor — a short turn is rarely a durable fact worth a write.
  if (text.length < SALIENCE_MIN_CHARS) return null;

  const sessionId =
    typeof input.session_id === 'string' && input.session_id.length > 0
      ? input.session_id
      : undefined;
  return {
    path: '/v1/remember',
    body: {
      ...(sessionId ? { sessionId } : env.userId ? { userId: env.userId } : {}),
      text,
      // M27 T3.1 — extract durable facts from the turn (the mem0-grade distillation
      // discipline + backstop gate live server-side). Explicit, not defaulted: the
      // stale "stores verbatim" comment was wrong, and the kit must never dump raw
      // narration as one memory.
      infer: true,
      attributedTo,
      metadata: { source: 'claude-code', project },
    },
  };
}

async function main() {
  const input = await readInput();
  const env = loadEnv();
  // Stop hook = the assistant's session summary → attributed to the assistant.
  // This keeps assistant-produced summaries from ever masquerading as user preferences.
  //
  // DETACHED: server-side LLM extraction takes ~8s through the gateway; a blocking await
  // would stall the session or abort at the 3s timeout and silently drop the write.
  const payload = buildRememberPayload({ input, env, attributedTo: 'assistant' });
  if (payload !== null) postDetached(payload.path, payload.body);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
    .catch(() => {
      // Fire-and-forget — never surface an error.
    })
    .finally(() => process.exit(0));
}
