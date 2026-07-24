// merge-settings.mjs — the load-bearing settings.json merge for the theo-memory kit.
//
// The machine already has a ~/.claude/settings.json with existing hooks. The installer
// MUST add the theo hook registrations WITHOUT removing or duplicating anything. This
// module is the single source of truth for that merge — both install.sh and
// test-merge.mjs call `mergeHooks(existing, additions)` so the tested code is the
// shipped code (no divergence).
//
// Contract:
//   - existing: the parsed settings.json object (may lack a `hooks` map).
//   - additions: { [eventName]: [ { matcher?, hooks:[{type:'command', command, ...}] } ] }
//   - returns: a NEW object (existing is not mutated) with additions merged in.
//   - Idempotent: an addition whose command already appears under the event is skipped,
//     so re-running the installer never duplicates the theo entries.

/**
 * Extract the concrete shell/command strings referenced by a hook-registration entry.
 * A registration is `{ matcher?, hooks: [ { type:'command', command } ] }`; we key
 * idempotency on the `command` strings it carries.
 *
 * @param {object} entry
 * @returns {string[]}
 */
function commandsOf(entry) {
  if (!entry || !Array.isArray(entry.hooks)) return [];
  return entry.hooks
    .map((h) => (h && typeof h.command === 'string' ? h.command : null))
    .filter((c) => c !== null);
}

/**
 * True if `event` (an array of registration entries) already contains a registration
 * carrying the SAME command as `addition`. Used to make the merge idempotent.
 *
 * @param {Array<object>} event
 * @param {object} addition
 * @returns {boolean}
 */
function alreadyPresent(event, addition) {
  const addCmds = commandsOf(addition);
  if (addCmds.length === 0) return false;
  for (const existing of event) {
    const existingCmds = commandsOf(existing);
    if (addCmds.some((c) => existingCmds.includes(c))) return true;
  }
  return false;
}

/**
 * Merge theo hook registrations into an existing settings object.
 *
 * Deep-clones the input (JSON round-trip — settings.json is plain JSON) so the caller's
 * object is never mutated. For each event in `additions`, appends any registration whose
 * command is not already present under that event. Existing registrations (theo or not)
 * are preserved untouched.
 *
 * @param {object} existing   parsed settings.json (may be {})
 * @param {object} additions  { [eventName]: registration[] }
 * @returns {object} a new merged settings object
 */
export function mergeHooks(existing, additions) {
  const merged = existing ? JSON.parse(JSON.stringify(existing)) : {};
  if (!merged.hooks || typeof merged.hooks !== 'object' || Array.isArray(merged.hooks)) {
    merged.hooks = {};
  }

  for (const [event, registrations] of Object.entries(additions || {})) {
    if (!Array.isArray(merged.hooks[event])) {
      merged.hooks[event] = Array.isArray(merged.hooks[event])
        ? merged.hooks[event]
        : [];
    }
    for (const registration of registrations) {
      if (!alreadyPresent(merged.hooks[event], registration)) {
        merged.hooks[event].push(registration);
      }
    }
  }

  return merged;
}

/**
 * The canonical theo hook registrations the installer merges in. Kept here so install.sh
 * and the test reference one definition. Commands assume the hooks are installed at
 * ~/.claude/hooks/theo-<x>.mjs and run via `node`.
 *
 * @param {string} [nodeBin='node']  the node binary to invoke
 * @param {string} [hooksDir='~/.claude/hooks']  where the .mjs files land
 * @returns {object} additions map for mergeHooks
 */
export function theoAdditions(nodeBin = 'node', hooksDir = '~/.claude/hooks') {
  return {
    SessionStart: [
      {
        matcher: 'startup|resume',
        hooks: [{ type: 'command', command: `${nodeBin} ${hooksDir}/theo-recall.mjs` }],
      },
    ],
    // M14 T1.3 — recall por-PROMPT: dispara em toda mensagem do usuário, busca pelo
    // prompt (não pelo nome do projeto), scoped ao Principal. Fecha o gap dos 79%
    // não-lidos. Timeout de 8s (o post do kit é bounded; nunca bloqueia o turno).
    UserPromptSubmit: [
      {
        hooks: [
          { type: 'command', command: `${nodeBin} ${hooksDir}/theo-prompt-recall.mjs`, timeout: 8 },
        ],
      },
    ],
    // M14 T3.1 — tool-context: quando um comando Bash falha (Traceback/panic/error), busca a
    // memória desse erro (a última vez que o vimos) e injeta via additionalContext. Só Bash;
    // pula git commit/merge e output curto. Timeout de 8s (post bounded; nunca bloqueia o turno).
    PostToolUse: [
      {
        matcher: 'Bash',
        hooks: [
          { type: 'command', command: `${nodeBin} ${hooksDir}/theo-tool-context.mjs`, timeout: 8 },
        ],
      },
    ],
    Stop: [
      {
        hooks: [
          { type: 'command', command: `${nodeBin} ${hooksDir}/theo-remember.mjs`, async: true },
        ],
      },
    ],
    PreCompact: [
      {
        hooks: [{ type: 'command', command: `${nodeBin} ${hooksDir}/theo-precompact.mjs` }],
      },
    ],
    // Session-separation (2026-07-23): M9 promotion trigger — end-of-session reflect
    // lifts durable session working memories to the (workspace, user) global tier.
    SessionEnd: [
      {
        hooks: [
          { type: 'command', command: `${nodeBin} ${hooksDir}/theo-promote.mjs`, async: true },
        ],
      },
    ],
  };
}
