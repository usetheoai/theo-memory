/**
 * T1.1 — `run_journey_audit.py` audit evaluator (catalog × evidence → verdict).
 *
 * The gate's integrity core. Implements golden-rule § 3 hard-cap order (NOT the plan
 * pseudo-code): #7 zero-anchor first → per-journey select ONE newest evidence (date, tie →
 * lexicographically-last filename) → validate #5 oracle_result + #6 secret BEFORE counting
 * #3 present+pass → #4 freshness (>30d stale, boundary inclusive). Covers EC-1..EC-7.
 *
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, test } from 'vitest';

const SCRIPT = join(process.cwd(), '.claude/skills/dogfood/scripts/run_journey_audit.py');
const GOLDEN = join(process.cwd(), '.claude/rules/dogfood-golden-rule.md');

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'dogfood-audit-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** ISO date `today − daysAgo` (dynamic — never a literal, per EC-4). */
function dateNDaysAgo(daysAgo: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

/** Minimal single-surface-per-line catalog; `anchor` all true unless overridden. */
function writeCatalog(
  rows: { id: string; surface: string; anchor?: string }[],
  aliases: Record<string, string[]> = {},
): string {
  const path = join(dir, 'journeys.md');
  const lines = ['# catalog', '', '| id | surface | title | anchor | oracle |', '|---|---|---|---|---|'];
  for (const r of rows) lines.push(`| ${r.id} | ${r.surface} | t | ${r.anchor ?? 'true'} | o |`);
  if (Object.keys(aliases).length) {
    lines.push('', '```yaml', 'aliases:');
    for (const [k, v] of Object.entries(aliases)) lines.push(`  ${k}: [${v.join(', ')}]`);
    lines.push('```');
  }
  writeFileSync(path, lines.join('\n'));
  return path;
}

function evidenceDir(): string {
  const p = join(dir, 'evidence');
  mkdirSync(p, { recursive: true });
  return p;
}

/** Write an evidence file; omit a field by passing `null`. */
function writeEvidence(
  edir: string,
  name: string,
  fm: { journey?: string | null; scenario?: string | null; date?: string; outcome?: string; oracle_result?: string | null; operator?: string; summary?: string },
): void {
  const f: Record<string, string> = {};
  const key = fm.journey !== undefined ? 'journey' : 'scenario';
  const keyVal = fm.journey ?? fm.scenario;
  if (keyVal != null) f[key] = keyVal;
  f['date'] = fm.date ?? dateNDaysAgo(1);
  f['operator'] = fm.operator ?? 'claude-code';
  f['outcome'] = fm.outcome ?? 'pass';
  if (fm.oracle_result !== null) f['oracle_result'] = fm.oracle_result ?? 'exit 0';
  f['summary'] = fm.summary ?? 's';
  const body = ['---', ...Object.entries(f).map(([k, v]) => `${k}: ${v}`), '---', 'body'].join('\n');
  writeFileSync(join(edir, name), body);
}

/** Run the audit; return parsed JSON (verdict + reds) + exit code. */
function audit(catalog: string, edir: string): { verdict: string; reds: { id: string; flag: string }[]; code: number } {
  try {
    const out = execFileSync('python3', [SCRIPT, '--catalog', catalog, '--evidence-dir', edir, '--golden-rule', GOLDEN], { encoding: 'utf8' });
    return { ...JSON.parse(out), code: 0 };
  } catch (e: unknown) {
    const err = e as { status?: number; stdout?: string };
    return { ...JSON.parse(err.stdout ?? '{}'), code: err.status ?? 1 };
  }
}

describe('T1.1 — run_journey_audit', () => {
  test('test_audit_green_catalog_emits_sufficient', () => {
    const c = writeCatalog([{ id: 'J-API-1', surface: 'API' }]);
    const e = evidenceDir();
    writeEvidence(e, 'a.md', { journey: 'J-API-1', outcome: 'pass', oracle_result: 'HTTP 200' });
    const r = audit(c, e);
    expect(r.verdict).toBe('EVIDENCE_SUFFICIENT');
    expect(r.reds).toEqual([]);
  });

  test('test_audit_missing_anchor_evidence_emits_insufficient_and_names_it', () => {
    const c = writeCatalog([{ id: 'J-API-1', surface: 'API' }]);
    const r = audit(c, evidenceDir());
    expect(r.verdict).toBe('EVIDENCE_INSUFFICIENT');
    expect(r.reds.map((x) => x.id)).toContain('J-API-1');
  });

  test('test_audit_red_anchor_journey_emits_insufficient', () => {
    const c = writeCatalog([{ id: 'J-API-1', surface: 'API' }]);
    const e = evidenceDir();
    writeEvidence(e, 'a.md', { journey: 'J-API-1', outcome: 'fail' });
    expect(audit(c, e).verdict).toBe('EVIDENCE_INSUFFICIENT');
  });

  test('test_audit_stale_anchor_evidence_emits_insufficient', () => {
    const c = writeCatalog([{ id: 'J-API-1', surface: 'API' }]);
    const e = evidenceDir();
    writeEvidence(e, 'a.md', { journey: 'J-API-1', date: dateNDaysAgo(31) });
    const r = audit(c, e);
    expect(r.verdict).toBe('EVIDENCE_INSUFFICIENT');
    expect(r.reds.find((x) => x.id === 'J-API-1')?.flag).toContain('stale');
  });

  test('test_audit_evidence_exactly_at_freshness_boundary_is_fresh', () => {
    const c = writeCatalog([{ id: 'J-API-1', surface: 'API' }]);
    const e = evidenceDir();
    writeEvidence(e, 'a.md', { journey: 'J-API-1', date: dateNDaysAgo(30) }); // exactly 30 → fresh
    expect(audit(c, e).verdict).toBe('EVIDENCE_SUFFICIENT');
  });

  test('test_audit_rejects_full_secret', () => {
    const c = writeCatalog([{ id: 'J-API-1', surface: 'API' }]);
    const e = evidenceDir();
    writeEvidence(e, 'a.md', { journey: 'J-API-1', oracle_result: 'key theo_live_' + 'A'.repeat(24) });
    const r = audit(c, e);
    expect(r.verdict).toBe('EVIDENCE_INSUFFICIENT');
    expect(r.reds.find((x) => x.id === 'J-API-1')?.flag).toContain('secret');
  });

  test('test_audit_allows_short_prefix', () => {
    const c = writeCatalog([{ id: 'J-API-1', surface: 'API' }]);
    const e = evidenceDir();
    writeEvidence(e, 'a.md', { journey: 'J-API-1', oracle_result: 'key theo_live_JnCE (prefix)' });
    expect(audit(c, e).verdict).toBe('EVIDENCE_SUFFICIENT');
  });

  test('test_audit_nonanchor_red_only_emits_with_caveats', () => {
    // With Q1 all-anchor, WITH_CAVEATS is reachable only via a non-anchor journey.
    const c = writeCatalog([
      { id: 'J-API-1', surface: 'API', anchor: 'true' },
      { id: 'J-API-2', surface: 'API', anchor: 'false' },
    ]);
    const e = evidenceDir();
    writeEvidence(e, 'a.md', { journey: 'J-API-1', outcome: 'pass' });
    writeEvidence(e, 'b.md', { journey: 'J-API-2', outcome: 'fail' });
    expect(audit(c, e).verdict).toBe('EVIDENCE_WITH_CAVEATS');
  });

  test('test_audit_legacy_scenario_field_satisfies_mapped_anchor', () => {
    const c = writeCatalog([{ id: 'J-SDK-1', surface: 'SDK' }], { 'J-SDK-1': ['claude-code-auto-memory'] });
    const e = evidenceDir();
    writeEvidence(e, 'legacy.md', { journey: undefined, scenario: 'claude-code-auto-memory', outcome: 'pass' });
    expect(audit(c, e).verdict).toBe('EVIDENCE_SUFFICIENT');
  });

  test('test_audit_pass_without_oracle_result_is_insufficient', () => {
    const c = writeCatalog([{ id: 'J-API-1', surface: 'API' }]);
    const e = evidenceDir();
    writeEvidence(e, 'a.md', { journey: 'J-API-1', outcome: 'pass', oracle_result: '   ' }); // whitespace-only
    const r = audit(c, e);
    expect(r.verdict).toBe('EVIDENCE_INSUFFICIENT');
    expect(r.reds.find((x) => x.id === 'J-API-1')?.flag).toContain('oracle');
  });

  test('test_audit_newest_fail_supersedes_older_pass', () => {
    const c = writeCatalog([{ id: 'J-API-1', surface: 'API' }]);
    const e = evidenceDir();
    writeEvidence(e, 'a-old.md', { journey: 'J-API-1', date: dateNDaysAgo(5), outcome: 'pass' });
    writeEvidence(e, 'b-new.md', { journey: 'J-API-1', date: dateNDaysAgo(1), outcome: 'fail' });
    expect(audit(c, e).verdict).toBe('EVIDENCE_INSUFFICIENT');
  });

  test('test_audit_orphan_evidence_ignored_not_crash', () => {
    const c = writeCatalog([{ id: 'J-API-1', surface: 'API' }]);
    const e = evidenceDir();
    writeEvidence(e, 'a.md', { journey: 'J-API-1', outcome: 'pass' });
    writeEvidence(e, 'orphan.md', { journey: 'J-ZZZ-9', outcome: 'pass' }); // not in catalog
    expect(audit(c, e).verdict).toBe('EVIDENCE_SUFFICIENT'); // orphan ignored, no crash
  });

  test('test_audit_zero_anchors_is_structural_insufficient', () => {
    const c = writeCatalog([{ id: 'J-API-1', surface: 'API', anchor: 'false' }]); // no anchor at all
    const r = audit(c, evidenceDir());
    expect(r.verdict).toBe('EVIDENCE_INSUFFICIENT');
    expect(r.reds.some((x) => x.flag.includes('no_anchor'))).toBe(true);
  });
});
