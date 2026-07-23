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

async function main() {
  const input = await readInput();
  const project = projectOf(input.cwd);
  const { userId } = loadEnv();
  // M6-SEC-01: scrub secrets BEFORE the write. The server stores infer=false
  // verbatim, so this client scrub is the only chance to keep a secret (an env
  // dump, a pasted key, a token in tool output) out of the store.
  const text = scrubText((input.last_assistant_message || '').trim());

  // Salience floor — a short turn is rarely a durable fact worth a write.
  if (text.length < SALIENCE_MIN_CHARS) return;

  // Session-separation (2026-07-23, M8 model): when the hook payload carries the
  // Claude Code session_id, the write targets the SESSION tier — the edge's
  // X-Theo-User-Id binds the user, so the scope is (workspace, user, session).
  // Each session gets its own working memory; the SessionEnd promote hook
  // (theo-promote.mjs) runs the M9 reflect that lifts durable facts to global.
  // Exactly ONE tier key may be sent (server superRefine): sessionId wins;
  // legacy userId pin (raw REST without edge) only applies when no session id.
  //
  // DETACHED: server-side LLM extraction takes ~8s through the gateway; a blocking
  // await would either stall the session that long OR (at the 3s default timeout)
  // abort and silently drop the write. postDetached hands it to a background worker
  // and returns immediately — the write lands, the session is never held.
  const sessionId = typeof input.session_id === 'string' && input.session_id.length > 0
    ? input.session_id
    : undefined;
  postDetached('/v1/remember', {
    ...(sessionId ? { sessionId } : userId ? { userId } : {}),
    text,
    metadata: { source: 'claude-code', project },
  });
}

main()
  .catch(() => {
    // Fire-and-forget — never surface an error.
  })
  .finally(() => process.exit(0));
