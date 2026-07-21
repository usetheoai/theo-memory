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

import { readInput, projectOf, post } from './theo-lib.mjs';
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

async function main() {
  const input = await readInput();
  const project = projectOf(input.cwd);
  // M6-SEC-01: the transcript tail is the highest-risk source — it routinely
  // carries tool_result blocks (env dumps, .env reads, API responses) with live
  // secrets. Scrub BEFORE the write (server stores infer=false verbatim).
  const text = scrubText(transcriptTail(input));

  if (text.length < SALIENCE_MIN_CHARS) return;

  await post('/v1/remember', {
    userId: project,
    text,
    metadata: { source: 'claude-code', project, phase: 'precompact' },
  });
}

main()
  .catch(() => {
    // Fire-and-forget — never surface an error.
  })
  .finally(() => process.exit(0));
