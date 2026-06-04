/**
 * T0.3 RED — CHANGELOG `**BREAKING (REST server):**` marker presence sentinel.
 *
 * The parent plan's stub-removal entry (REST server hard-fail on missing
 * OPENAI_API_KEY + StubLLM/DeterministicStubEmbedder removal) is a behavioral
 * break visible to consumers running `themory server`. `/review` F-dom-api-2
 * MAJOR: the [Unreleased] CHANGELOG entry describes the change but lacks the
 * consumer-greppable `**BREAKING:**` marker that Inquebrável Rule 6 calls for
 * (the Keep-a-Changelog spec permits the marker prefix inside the `Changed`
 * category — no new category needed; D4 rationale in plan).
 *
 * This test extracts the `[Unreleased]` slice from CHANGELOG.md (everything
 * between `## [Unreleased]` and the next versioned `## [` header) and asserts
 * the marker is present somewhere inside it.
 *
 * @see .claude/knowledge-base/plans/p0-api-sdk-mcp-correctness-audit-fixes-cycle-1-plan.md § T0.3 + ADR D4
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const CHANGELOG_PATH = join(REPO_ROOT, 'CHANGELOG.md');

function extractUnreleased(changelog: string): string {
  const start = changelog.indexOf('## [Unreleased]');
  if (start === -1) return '';
  const after = changelog.slice(start);
  const nextRel = after.search(/\n## \[\d/);
  return nextRel === -1 ? after : after.slice(0, nextRel);
}

describe('T0.3 — CHANGELOG BREAKING marker for REST server stub-removal', () => {
  test('1. Unreleased section contains `**BREAKING (REST server):**` marker (F-dom-api-2)', () => {
    const changelog = readFileSync(CHANGELOG_PATH, 'utf8');
    const unreleased = extractUnreleased(changelog);
    expect(unreleased.length, 'sanity — [Unreleased] section present').toBeGreaterThan(0);
    expect(unreleased).toContain('**BREAKING (REST server):**');
  });
});
