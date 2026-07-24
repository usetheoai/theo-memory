#!/usr/bin/env node
// theo-block-memory-write.test.mjs — T3.2 (M14) TDD: guarda anti-escrita em MEMORY.md.
//
// Run: node --test docs/claude-code-kit/hooks/theo-block-memory-write.test.mjs
//
// O critério de aceite é o EXIT CODE do processo (2 = block, 0 = allow), então o teste
// spawna o hook real com o payload no stdin (fiel ao contrato PreToolUse do Claude Code).
// Também exercita a função pura `evaluateWrite(input)` para asserções rápidas.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { evaluateWrite } from './theo-block-memory-write.mjs';

const HOOK = fileURLToPath(new URL('./theo-block-memory-write.mjs', import.meta.url));

/** Spawna o hook com `payload` no stdin; retorna { status, stderr }. */
function runHook(payload) {
  const res = spawnSync('node', [HOOK], { input: JSON.stringify(payload), encoding: 'utf8' });
  return { status: res.status, stderr: res.stderr ?? '' };
}

test('test_blocks_memory_md_write — path */MEMORY.md → exit 2 + stderr de redirecionamento', () => {
  const { status, stderr } = runHook({
    tool_name: 'Write',
    tool_input: { file_path: '/home/user/.claude/MEMORY.md', content: 'x' },
  });
  assert.equal(status, 2);
  assert.match(stderr, /remember/i); // redireciona ao nosso remember/MCP
});

test('test_blocks_bare_memory_md — path exatamente "MEMORY.md" também bloqueia', () => {
  const { status } = runHook({ tool_name: 'Edit', tool_input: { file_path: 'MEMORY.md' } });
  assert.equal(status, 2);
});

test('test_allows_other_writes — path normal → exit 0 (sem bloqueio)', () => {
  const { status } = runHook({
    tool_name: 'Write',
    tool_input: { file_path: '/home/user/project/src/index.ts', content: 'y' },
  });
  assert.equal(status, 0);
});

test('test_allows_memory_substring — "MEMORY.md.bak" NÃO bloqueia (só o arquivo exato)', () => {
  const { status } = runHook({
    tool_name: 'Write',
    tool_input: { file_path: '/x/MEMORY.md.bak' },
  });
  assert.equal(status, 0);
});

test('test_evaluateWrite_pure — a função pura classifica block/allow por file_path', () => {
  assert.equal(evaluateWrite({ tool_input: { file_path: '/a/b/MEMORY.md' } }).block, true);
  assert.equal(evaluateWrite({ tool_input: { file_path: '/a/b/notes.md' } }).block, false);
  assert.equal(evaluateWrite({ tool_input: {} }).block, false); // sem path → não bloqueia
});
