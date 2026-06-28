/**
 * `themory remember` handler — `--no-infer` verbatim-path coverage.
 *
 * Issue #79 (DX/CLI parity): the CLI `remember` verb exposed no equivalent to
 * the REST `infer: false` flag, so a CLI write → recall round-trip depended
 * entirely on LLM extraction (impossible to make deterministic on a no-LLM /
 * mock-LLM backend). These tests pin the contract that `runRemember` forwards
 * the `infer` toggle to `ScopedMemory.remember(text, { infer })`, mirroring
 * the REST handler (`packages/api/src/server/handlers/remember.ts:44`).
 *
 * @see https://github.com/usetheodev/theo-memory/issues/79
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runRemember } from '../run-remember.js';

const rememberSpy = vi.fn().mockResolvedValue([]);
const disposeSpy = vi.fn().mockResolvedValue(undefined);
const memoryStub = {
  user: vi.fn(() => ({ remember: rememberSpy })),
  session: vi.fn(() => ({ remember: rememberSpy })),
  agent: vi.fn(() => ({ remember: rememberSpy })),
};

vi.mock('@usetheo/memory-agent-core', () => ({
  createAgentToolsMemory: vi.fn(async () => [memoryStub, disposeSpy]),
}));

beforeEach(() => {
  vi.clearAllMocks();
  rememberSpy.mockResolvedValue([]);
  disposeSpy.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('runRemember — infer toggle (issue #79 REST parity)', () => {
  it('passes { infer: false } to scoped.remember when infer is false (verbatim path)', async () => {
    await runRemember({ text: 'verbatim fact', user: 'u1', format: 'json', infer: false });
    expect(rememberSpy).toHaveBeenCalledTimes(1);
    expect(rememberSpy).toHaveBeenCalledWith('verbatim fact', { infer: false });
  });

  it('does NOT force infer when omitted (engine default extraction preserved)', async () => {
    await runRemember({ text: 'extract me', user: 'u1', format: 'json' });
    expect(rememberSpy).toHaveBeenCalledTimes(1);
    expect(rememberSpy).toHaveBeenCalledWith('extract me');
  });

  it('does NOT force infer when infer is true (default LLM extraction)', async () => {
    await runRemember({ text: 'extract me', user: 'u1', format: 'json', infer: true });
    expect(rememberSpy).toHaveBeenCalledWith('extract me');
  });
});
