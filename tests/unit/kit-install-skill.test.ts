/**
 * M12 T2.1 — the kit installer copies the skills/ dir to ~/.claude/skills (mirrors hooks copy).
 * Runs install.sh against a TEMP HOME (never the real one).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const fakeHome = mkdtempSync(join(tmpdir(), 'm12-kit-home-'));
afterAll(() => rmSync(fakeHome, { recursive: true, force: true }));

describe('M12 kit install.sh — skills copy', () => {
  it('test_install_sh_copies_skill_to_claude_skills', () => {
    execFileSync('bash', ['docs/claude-code-kit/install.sh'], {
      env: { ...process.env, HOME: fakeHome },
      stdio: 'pipe',
    });
    const skill = join(fakeHome, '.claude', 'skills', 'migrate-theo-memory', 'SKILL.md');
    expect(existsSync(skill)).toBe(true);
    const body = readFileSync(skill, 'utf8');
    // Orchestration contract markers: dry-run first + explicit confirmation + never re-implement.
    expect(body).toContain('import claude-code');
    expect(body).toContain('--commit');
    expect(body).toMatch(/[Nn]ever/);
    // The hooks + scrub copy still happens (pre-existing behavior intact).
    expect(existsSync(join(fakeHome, '.claude', 'hooks', 'theo-scrub.mjs'))).toBe(true);
  });
});
