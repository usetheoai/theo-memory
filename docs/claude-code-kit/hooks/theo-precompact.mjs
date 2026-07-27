#!/usr/bin/env node
// theo-precompact.mjs — PreCompact hook: flush-before-forget.
//
// Before Claude Code compacts context away, persist the working memory so nothing
// durable is lost. Same shape as the Stop remember: derive project from cwd, take the
// transcript tail if the payload carries one, else fall back to last_assistant_message,
// fire-and-forget to /v1/remember.
//
// Exit 0 regardless — a memory outage never blocks compaction (plan T3.1).

import { readFileSync } from 'node:fs';

import { readInput, projectOf, postDetached, loadEnv } from './theo-lib.mjs';
import { scrubText } from './theo-scrub.mjs';

const SALIENCE_MIN_CHARS = 40;
const TRANSCRIPT_TAIL_CHARS = 4000;

// Best-effort read of the transcript tail. The PreCompact payload may carry a
// `transcript_path`; if present + readable, use its tail, else reuse the last message.
// Never throws — any failure falls back to the message field.
function transcriptTail(input) {
  const path = input.transcript_path;
  if (typeof path === 'string' && path.length > 0) {
    try {
      const raw = readFileSync(path, 'utf8');
      return raw.slice(-TRANSCRIPT_TAIL_CHARS).trim();
    } catch {
      // Unreadable transcript — fall through to the message field.
    }
  }
  return (input.last_assistant_message || '').trim();
}

/**
 * Pure, testable core (M26 seam closure): build the `/v1/remember` payload for a PreCompact
 * flush, or null when below the salience floor. A precompact captures a MIXED transcript tail,
 * so — unlike the assistant-only Stop hook — it declares NO single `attributedTo`; attribution
 * is left to the LLM per-fact guess (multi-peer). It sets `infer: true` explicitly (the server
 * runs extraction; the old "stores verbatim" comment was wrong, M27 T3.1).
 *
 * @param {{ input: object, env: {userId: string} }} deps
 * @returns {{ path: string, body: object } | null}
 */
export function buildPrecompactPayload({ input, env }) {
  const project = projectOf(input.cwd);
  // M6-SEC-01: the transcript tail is the highest-risk source — it routinely carries
  // tool_result blocks (env dumps, .env reads, API responses) with live secrets. Scrub
  // BEFORE the write; the server then extracts durable facts (infer:true) from the scrubbed text.
  const text = scrubText(transcriptTail(input));
  if (text.length < SALIENCE_MIN_CHARS) return null;

  // Session-separation (2026-07-23): the flush belongs to the compacting SESSION's working
  // memory (M8) — sessionId wins over the legacy userId pin (one tier key).
  const sessionId =
    typeof input.session_id === 'string' && input.session_id.length > 0 ? input.session_id : undefined;
  return {
    path: '/v1/remember',
    body: {
      ...(sessionId ? { sessionId } : env.userId ? { userId: env.userId } : {}),
      text,
      infer: true,
      metadata: { source: 'claude-code', project, phase: 'precompact' },
    },
  };
}

async function main() {
  const input = await readInput();
  const env = loadEnv();
  // DETACHED so the ~8s server-side extraction never stalls compaction (see theo-lib
  // postDetached) and never aborts under the 3s timeout.
  const payload = buildPrecompactPayload({ input, env });
  if (payload !== null) postDetached(payload.path, payload.body);
}

// Guard so `import`ing this module (e.g. the test) does NOT execute main() and hang on stdin.
if (import.meta.url === `file://${process.argv[1]}`) {
  main()
    .catch(() => {
      // Fire-and-forget — never surface an error.
    })
    .finally(() => process.exit(0));
}
