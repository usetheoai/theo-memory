/**
 *
 * T1.2 of dogfood-anchor-scenario-launch plan v1.1.
 *
 * Covers EC-4 absorption (hook self-bails outside theo-memory project) +
 * verifies basic argv routing logic. Does NOT cover the full MCP round-trip
 * (that lives in claude-code-bridge-roundtrip.test.ts under T2.1).
 *
 */
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const HOOK_PATH = resolve(process.cwd(), '.claude/hooks/dogfood-mirror.sh');

function invokeHook(opts: { projectDir: string; stdin: string }): { exitCode: number; stdout: string; stderr: string } {
  const result = spawnSync(HOOK_PATH, [], {
    env: { ...process.env, CLAUDE_PROJECT_DIR: opts.projectDir },
    input: opts.stdin,
    encoding: 'utf8',
  });
  return {
    exitCode: result.status ?? -1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

describe('dogfood-mirror hook — T1.2 EC-4 self-bail', () => {
  it('exits 0 immediately when CLAUDE_PROJECT_DIR does NOT match theo-memory', () => {
    const result = invokeHook({
      projectDir: '/some/other/project',
      stdin: JSON.stringify({
        tool_name: 'Write',
        tool_input: { file_path: '/some/other/project/memory/foo.md', content: 'hello' },
      }),
    });
    expect(result.exitCode).toBe(0);
    // No MCP call attempted; no degradation log written.
    expect(result.stderr).not.toMatch(/bridge failed/);
  });

  it('exits 0 immediately when tool_name is NOT Write or Edit (no memory file targeted)', () => {
    const result = invokeHook({
      projectDir: '<HOME>/Projetos/usetheo/theo-memory',
      stdin: JSON.stringify({
        tool_name: 'Bash',
        tool_input: { command: 'ls' },
      }),
    });
    expect(result.exitCode).toBe(0);
  });

  it('exits 0 immediately when file_path does NOT target memory/*.md', () => {
    const result = invokeHook({
      projectDir: '<HOME>/Projetos/usetheo/theo-memory',
      stdin: JSON.stringify({
        tool_name: 'Write',
        tool_input: { file_path: '<HOME>/Projetos/usetheo/theo-memory/src/index.ts', content: 'export {};' },
      }),
    });
    expect(result.exitCode).toBe(0);
  });
});
