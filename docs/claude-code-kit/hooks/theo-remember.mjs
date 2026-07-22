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

  // Omit userId by default so the gateway's injected X-Theo-User-Id drives the tier
  // (unified per-account memory). An explicit THEOMEM_MEMORY_USER_ID pins it for raw
  // REST. `project` stays in metadata either way — for context, not for scoping.
  //
  // DETACHED: server-side LLM extraction takes ~8s through the gateway; a blocking
  // await would either stall the session that long OR (at the 3s default timeout)
  // abort and silently drop the write. postDetached hands it to a background worker
  // and returns immediately — the write lands, the session is never held.
  postDetached('/v1/remember', {
    ...(userId ? { userId } : {}),
    text,
    metadata: { source: 'claude-code', project },
  });
}

main()
  .catch(() => {
    // Fire-and-forget — never surface an error.
  })
  .finally(() => process.exit(0));
