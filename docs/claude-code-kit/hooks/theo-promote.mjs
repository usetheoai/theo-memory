#!/usr/bin/env node
// theo-promote.mjs — SessionEnd hook: session→global PROMOTION (M9).
//
// When a Claude Code session ends, fire the session-scoped reflect: the server
// threads the SessionToGlobalConsolidationPolicy, promoting durable working
// memories (confirmation_count >= threshold) from (workspace, user, session) to
// the (workspace, user) global tier. Non-durable session memories stay behind
// and decay via the shipped triadic eviction — exactly the M8–M11 design.
//
// Exit 0 regardless — a memory outage never blocks session teardown.

import { readInput, postDetached } from './theo-lib.mjs';

async function main() {
  const input = await readInput();
  const sessionId = typeof input.session_id === 'string' && input.session_id.length > 0
    ? input.session_id
    : undefined;
  // No session id → nothing to promote (the writes went to the global tier anyway).
  if (!sessionId) return;

  // DETACHED: promotion is pure SQL server-side (no LLM), but the gateway hop can
  // still stall; teardown must never wait on it.
  postDetached('/v1/reflect', { sessionId });
}

main()
  .catch(() => {
    // Fire-and-forget — never surface an error.
  })
  .finally(() => process.exit(0));
