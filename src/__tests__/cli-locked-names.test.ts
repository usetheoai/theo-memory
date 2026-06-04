/**
 * verbs-as-cli-fixes-cycle-1 T5.3 — sentinel test guarding the locked CLI
 * surface enumerated in `CLAUDE.md § Locked names`.
 *
 * The 4 verb-command names + 9 stable flag literals MUST remain present in
 * `src/agent-tools/cli.ts`. Removing any of them is a v1.0 contract breaking
 * change requiring CLAUDE.md amendment + CHANGELOG entry — this test enforces
 * the discipline at the contract layer so a silent removal is caught by the
 * gate, not by downstream consumers.
 *
 * Closes F-dom-api-3 (MAJOR) from `/review verbs-as-cli` 2026-06-04.
 *
 * @see CLAUDE.md § Locked names → `themory CLI verbs` + `themory CLI flags (stable)`
 * @see .claude/knowledge-base/plans/verbs-as-cli-fixes-cycle-1-plan.md § T5.3
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_SRC_PATH = join(__dirname, '..', 'agent-tools', 'cli.ts');

const LOCKED_VERBS = [
  "'remember <text>'",
  "'recall <query>'",
  "'forget <id>'",
  "'reflect'",
] as const;

const LOCKED_FLAGS = [
  '--user',
  '--session',
  '--agent',
  '--top-k',
  '--threshold',
  '--diversify',
  '--hard',
  '--json',
  '--text',
] as const;

describe('Locked CLI surface — CLAUDE.md § Locked names sentinel', () => {
  test('cli.ts contains the 4 locked verb-command names', () => {
    const src = readFileSync(CLI_SRC_PATH, 'utf8');
    for (const verb of LOCKED_VERBS) {
      expect(
        src,
        `cli.ts MUST contain verb-command literal ${verb} (v1.0 strategic locked name per CLAUDE.md)`,
      ).toContain(verb);
    }
  });

  test('cli.ts contains the 9 locked stable flag literals', () => {
    const src = readFileSync(CLI_SRC_PATH, 'utf8');
    for (const flag of LOCKED_FLAGS) {
      expect(
        src,
        `cli.ts MUST contain flag literal ${flag} (v1.0 strategic locked name per CLAUDE.md)`,
      ).toContain(flag);
    }
  });
});
