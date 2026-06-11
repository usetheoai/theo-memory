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
const REPO_ROOT = join(__dirname, '..', '..', '..');
const CHANGELOG_PATH = join(REPO_ROOT, 'CHANGELOG.md');

describe('T0.3 — CHANGELOG BREAKING marker for REST server stub-removal', () => {
  test('1. CHANGELOG contains `**BREAKING (REST server):**` marker somewhere (F-dom-api-2)', () => {
    // Marker may live in [Unreleased] OR in a versioned section once
    // [Unreleased] has been migrated forward at release-cut time. Scan the
    // full CHANGELOG so the regression sentinel survives version migrations
    // per Inquebrável Rule 6 forward-migration discipline.
    const changelog = readFileSync(CHANGELOG_PATH, 'utf8');
    expect(changelog).toContain('**BREAKING (REST server):**');
  });
});
