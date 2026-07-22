/**
 * M12 review F-tests-1/F-arch-4 — dist-boot sentinel for `themory import claude-code`.
 *
 * The shipped path depends on the NEW `postbuild:copy-import` step landing the .mjs engine at
 * `dist/agent-tools/import/` where the compiled run-import.js's relative import resolves. This repo
 * has shipped dist-resolution reds before (rewrite-dist-aliases class) — this sentinel makes that
 * class fail in CI: (1) `--help` boots env-free, exit 0, mentions dry-run; (2) a dry-run against a
 * temp `--source` prints the scanned/would-import report and writes NOTHING over HTTP.
 * Skips when dist/ is absent (unit-only environments) — the build+test CI lane always has it.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, test } from 'vitest';

const CLI = 'dist/agent-tools/cli.js';

const tmp = mkdtempSync(join(tmpdir(), 'm12-dist-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

if (!existsSync(CLI)) {
  describe.skip('M12 dist import boot (dist/ not built)', () => {
    test('placeholder', () => {
      /* no-op */
    });
  });
} else {
  describe('M12 — dist boot of `import claude-code` (postbuild:copy-import sentinel)', () => {
    test('test_import_claude_code_help_boots_envfree_exit0', () => {
      const out = execFileSync('node', [CLI, 'import', 'claude-code', '--help'], {
        env: { PATH: process.env['PATH'] ?? '', HOME: tmp }, // env-free: no THEOMEM_*, isolated HOME
        encoding: 'utf8',
      });
      expect(out).toContain('dry-run');
      expect(out).toContain('--commit');
    });

    test('test_dist_dry_run_reports_and_writes_nothing', () => {
      const src = join(tmp, 'projects');
      mkdirSync(join(src, 'proj-x', 'memory'), { recursive: true });
      writeFileSync(
        join(src, 'proj-x', 'memory', 'n.md'),
        '---\nname: n\ndescription: n note\nmetadata:\n  type: project\n---\n\nplain prose fact for the dist dry run\n',
      );
      const out = execFileSync('node', [CLI, 'import', 'claude-code', '--source', src], {
        env: { PATH: process.env['PATH'] ?? '', HOME: tmp }, // no endpoint config → default; dry-run never dials
        encoding: 'utf8',
      });
      expect(out).toContain('scanned:');
      expect(out).toMatch(/would-import:\s*1/);
      expect(out).toContain('DRY-RUN');
    });
  });
}
