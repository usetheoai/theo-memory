/**
 * verbs-as-cli-fixes-cycle-2 T3.3 / ADR D6 — sentinel for locked CLI surface.
 *
 * Replaces fix-cycle-1 substring grep (.toContain) with REGEX-PINNED checks
 * matching:
 *   - Verbs INSIDE `.command('verb-pattern')` call sites
 *   - Flags INSIDE `.option('--flag<boundary>')` call sites where the
 *     boundary char (`\s`, `'`, `"`, `<`) prevents false-positive matches
 *     against (a) `--user-name` (compound option that has `--user` as
 *     prefix), or (b) factory invocations like `parseIntInRange('--top-k', 1, 100)`
 *     where the literal appears in non-command-registration context.
 *
 * Closes M6 + EC-4 from `/review verbs-as-cli-fixes-cycle-1` 2026-06-04.
 *
 * @see CLAUDE.md § Locked names → `themory CLI verbs` + `themory CLI flags (stable)`
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_SRC_PATH = join(__dirname, '..', '..', '..', 'packages', 'cli', 'src', 'cli.ts');

interface VerbExpectation {
  readonly name: string;
  readonly pattern: RegExp;
}

interface FlagExpectation {
  readonly name: string;
  readonly pattern: RegExp;
}

// Verbs MUST be the FIRST argument of `.command()` calls. The regex pins the
// literal verb-pattern to `.command(...)` invocations.
const LOCKED_VERBS: readonly VerbExpectation[] = [
  { name: "'remember <text>'", pattern: /\.command\(\s*['"]remember <text>['"]/ },
  { name: "'recall <query>'", pattern: /\.command\(\s*['"]recall <query>['"]/ },
  { name: "'forget <id>'", pattern: /\.command\(\s*['"]forget <id>['"]/ },
  { name: "'reflect'", pattern: /\.command\(\s*['"]reflect['"]/ },
];

// Flags MUST be the FIRST argument of `.option()` calls. The boundary char
// class `[\s'"<]` after the flag name prevents false-positive matches:
//   - `--user-name` (compound option) does NOT match `/--user[\s'"<]/`
//     because `-` is not in the boundary class.
//   - `parseIntInRange('--top-k', 1, 100)` factory-arg context does NOT match
//     `/\.option\(\s*['"]--top-k[\s'"<]/` because the surrounding call is
//     not `.option(`.
const LOCKED_FLAGS: readonly FlagExpectation[] = [
  { name: '--user', pattern: /\.option\(\s*['"]--user[\s'"<]/ },
  { name: '--session', pattern: /\.option\(\s*['"]--session[\s'"<]/ },
  { name: '--agent', pattern: /\.option\(\s*['"]--agent[\s'"<]/ },
  { name: '--top-k', pattern: /\.option\(\s*['"]--top-k[\s'"<]/ },
  { name: '--threshold', pattern: /\.option\(\s*['"]--threshold[\s'"<]/ },
  { name: '--diversify', pattern: /\.option\(\s*['"]--diversify[\s'"<]/ },
  { name: '--hard', pattern: /\.option\(\s*['"]--hard[\s'"<]/ },
  { name: '--json', pattern: /\.option\(\s*['"]--json[\s'"<]/ },
  { name: '--text', pattern: /\.option\(\s*['"]--text[\s'"<]/ },
];

describe('Locked CLI surface — CLAUDE.md § Locked names sentinel (regex-pinned per ADR D6)', () => {
  test('cli.ts contains the 4 locked verb-command names INSIDE .command() calls', () => {
    const src = readFileSync(CLI_SRC_PATH, 'utf8');
    for (const verb of LOCKED_VERBS) {
      expect(
        src,
        `cli.ts MUST contain verb-command literal ${verb.name} INSIDE a .command(...) call (v1.0 strategic locked name per CLAUDE.md)`,
      ).toMatch(verb.pattern);
    }
  });

  test('cli.ts contains the 9 locked stable flag literals INSIDE .option() calls', () => {
    const src = readFileSync(CLI_SRC_PATH, 'utf8');
    for (const flag of LOCKED_FLAGS) {
      expect(
        src,
        `cli.ts MUST contain flag literal ${flag.name} INSIDE a .option(...) call site with boundary char after the flag name (v1.0 strategic locked name per CLAUDE.md)`,
      ).toMatch(flag.pattern);
    }
  });
});
