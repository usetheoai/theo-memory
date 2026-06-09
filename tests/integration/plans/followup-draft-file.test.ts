/**
 * T6.1 — Followup DRAFT plan file existence + citation-fidelity assertion (EC-5).
 *
 * Closes the sub-goal 7 orphan from `dashboard-memories-tab-standardization-plan.md`:
 * the 5 OTHER `createdAt: new Date()` instances (recall + 2 reflection + 2 skill
 * paths) MUST be tracked in a follow-up DRAFT plan file so the deferred bug
 * becomes traceable debt instead of invisible debt.
 *
 * Without this test, T6.1 could silently regress (GREEN-ship a DRAFT that lacks
 * the citations) and the next `/to-plan` invocation against the follow-up slug
 * would have nothing to inherit.
 *
 * Citation lines per SEPA pre-RED M1 (post T1.1 + T2.1 + T2.2 commits):
 *   - src/local/index.ts:644  — recall MemoryItem
 *   - src/local/index.ts:757  — reflect derived MemoryItem
 *   - src/local/index.ts:980  — history/retrieval MemoryItem
 *   - src/local/scoped-skill-memory.ts:104
 *   - src/local/skills/payload.ts:78
 *
 * @see .claude/knowledge-base/plans/dashboard-memories-tab-standardization-plan.md § T6.1 + ADR D5
 * @see .claude/knowledge-base/reviews/dashboard-memories-tab-standardization-edge-cases-2026-06-08.md § EC-5
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, test } from 'vitest';

const REPO_ROOT = resolve(__dirname, '../../..');
const DRAFT_PATH = resolve(
  REPO_ROOT,
  '.claude/knowledge-base/plans/themory-temporal-fidelity-full-fix-DRAFT.md',
);

describe('T6.1 — themory-temporal-fidelity-full-fix DRAFT plan file (EC-5)', () => {
  test('test_followup_draft_file_exists_at_canonical_path', () => {
    expect(existsSync(DRAFT_PATH)).toBe(true);
  });

  test('frontmatter declares slug + status: DRAFT + created_at + goal', () => {
    const body = readFileSync(DRAFT_PATH, 'utf8');
    expect(body).toMatch(/^---/);
    expect(body).toContain('slug: themory-temporal-fidelity-full-fix');
    expect(body).toContain('status: DRAFT');
    expect(body).toMatch(/created_at:\s*2026-06-0[89]/);
    expect(body).toContain('goal:');
  });

  test('cites all 5 deferred createdAt instance file:line refs (SEPA-corrected lines)', () => {
    const body = readFileSync(DRAFT_PATH, 'utf8');
    expect(body).toContain('src/local/index.ts:644');
    expect(body).toContain('src/local/index.ts:757');
    expect(body).toContain('src/local/index.ts:980');
    expect(body).toContain('src/local/scoped-skill-memory.ts:104');
    expect(body).toContain('src/local/skills/payload.ts:78');
  });

  test('inherits from dashboard-memories-tab-standardization-plan.md ADR D5', () => {
    const body = readFileSync(DRAFT_PATH, 'utf8');
    expect(body).toContain('dashboard-memories-tab-standardization-plan.md');
    expect(body).toContain('ADR D5');
  });

  test('declares v1.1 bi-temporal asOf empirical validation gap', () => {
    const body = readFileSync(DRAFT_PATH, 'utf8');
    expect(body).toContain('asOf');
    expect(body).toContain('v1.1');
    expect(body.toLowerCase()).toContain('empirical');
  });
});
