#!/usr/bin/env node
// test-merge.mjs — standalone test for the settings.json merge (NO vitest).
//
// Run: node docs/claude-code-kit/test-merge.mjs
//
// The merge is the load-bearing, testable part of the kit: the installer MUST add the
// theo hook registrations to a settings.json that ALREADY has hooks, without clobbering
// them and without duplicating the theo entries on a re-run. This test asserts exactly
// that against the SAME `mergeHooks` the installer calls.

import { mergeHooks, theoAdditions } from './hooks/merge-settings.mjs';

let failures = 0;
function assert(cond, msg) {
  if (cond) {
    console.log(`  PASS: ${msg}`);
  } else {
    console.error(`  FAIL: ${msg}`);
    failures += 1;
  }
}

// A realistic pre-existing settings.json with 3 hooks across 3 events.
const existing = {
  model: 'claude-opus-4-8',
  hooks: {
    SessionStart: [
      { hooks: [{ type: 'command', command: 'node ~/.claude/hooks/existing-session.mjs' }] },
    ],
    PreToolUse: [
      {
        matcher: 'Bash',
        hooks: [{ type: 'command', command: 'bash ~/.claude/hooks/validate-command.sh' }],
      },
    ],
    Stop: [
      { hooks: [{ type: 'command', command: 'node ~/.claude/hooks/existing-stop.mjs' }] },
    ],
  },
};

const additions = theoAdditions('node', '~/.claude/hooks');

// --- Merge once ---------------------------------------------------------------
const merged = mergeHooks(existing, additions);

// Helper: collect every command string under an event.
const cmds = (obj, event) =>
  (obj.hooks[event] || []).flatMap((e) => (e.hooks || []).map((h) => h.command));

console.log('Test group A — original hooks survive the merge:');
assert(
  cmds(merged, 'SessionStart').includes('node ~/.claude/hooks/existing-session.mjs'),
  'original SessionStart hook preserved',
);
assert(
  cmds(merged, 'PreToolUse').includes('bash ~/.claude/hooks/validate-command.sh'),
  'original PreToolUse hook preserved',
);
assert(
  cmds(merged, 'Stop').includes('node ~/.claude/hooks/existing-stop.mjs'),
  'original Stop hook preserved',
);

console.log('Test group B — theo hooks were added:');
assert(
  cmds(merged, 'SessionStart').includes('node ~/.claude/hooks/theo-recall.mjs'),
  'theo-recall registered on SessionStart',
);
assert(
  cmds(merged, 'Stop').includes('node ~/.claude/hooks/theo-remember.mjs'),
  'theo-remember registered on Stop',
);
assert(
  cmds(merged, 'PreCompact').includes('node ~/.claude/hooks/theo-precompact.mjs'),
  'theo-precompact registered on PreCompact',
);

console.log('Test group C — the input object was not mutated:');
assert(
  cmds(existing, 'SessionStart').length === 1 &&
    !cmds(existing, 'SessionStart').includes('node ~/.claude/hooks/theo-recall.mjs'),
  'original `existing` object untouched by merge (deep-clone)',
);

// --- Merge a SECOND time (idempotency) ---------------------------------------
const mergedTwice = mergeHooks(merged, additions);

console.log('Test group D — a second merge does not duplicate the theo entries:');
assert(
  cmds(mergedTwice, 'SessionStart').filter((c) => c === 'node ~/.claude/hooks/theo-recall.mjs')
    .length === 1,
  'theo-recall appears exactly once after a second merge',
);
assert(
  cmds(mergedTwice, 'Stop').filter((c) => c === 'node ~/.claude/hooks/theo-remember.mjs')
    .length === 1,
  'theo-remember appears exactly once after a second merge',
);
assert(
  cmds(mergedTwice, 'PreCompact').filter(
    (c) => c === 'node ~/.claude/hooks/theo-precompact.mjs',
  ).length === 1,
  'theo-precompact appears exactly once after a second merge',
);
assert(
  cmds(mergedTwice, 'Stop').includes('node ~/.claude/hooks/existing-stop.mjs'),
  'original Stop hook still present after the second merge',
);

// --- Edge: settings.json with NO hooks map -----------------------------------
console.log('Test group E — merge into a settings object with no `hooks` map:');
const bare = mergeHooks({ model: 'x' }, additions);
assert(
  cmds(bare, 'SessionStart').includes('node ~/.claude/hooks/theo-recall.mjs'),
  'theo hooks added even when `hooks` map was absent',
);

// --- Result ------------------------------------------------------------------
if (failures === 0) {
  console.log('\nPASS — all merge assertions held.');
  process.exit(0);
} else {
  console.error(`\nFAIL — ${failures} assertion(s) failed.`);
  process.exit(1);
}
