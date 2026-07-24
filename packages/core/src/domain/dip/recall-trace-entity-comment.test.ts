import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * M15 T3.4 (#122) — sentinel over documentation that became false.
 *
 * `recall-trace-store.ts` used to instruct readers NOT to read signal from the `entity`
 * component, because it was uniformly zero. With the boost wired that instruction is wrong,
 * and a stale instruction is worse than none: it tells an operator to ignore a column that
 * now carries real information.
 */
describe('recall trace entity component documentation', () => {
  it('test_trace_comment_does_not_instruct_to_ignore_entity', () => {
    const source = readFileSync(
      fileURLToPath(new URL('./recall-trace-store.ts', import.meta.url)),
      'utf8',
    );

    expect(source).not.toMatch(/Do NOT read signal into it/);
    expect(source).toMatch(/carries real signal as of M15/);
  });
});
