#!/usr/bin/env node
// theo-tool-context.test.mjs — T3.1 (M14) TDD: PostToolUse Bash erro-context.
//
// Run: node --test docs/claude-code-kit/hooks/theo-tool-context.test.mjs
//
// Testa a função pura `buildToolContext({ input, post, env })`. Quando um comando Bash
// falha (Traceback/panic/Error), busca a memória do erro (a última vez que o vimos) e a
// injeta via PostToolUse.additionalContext. Scope do Principal server-side (ADR-M14-1) —
// o hook só manda a linha de erro como query. Padrão de injeção de deps (DIP) para stubar a rede.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildToolContext } from './theo-tool-context.mjs';

function stubPost(result = { results: [] }) {
  const calls = [];
  const post = async (path, body) => {
    calls.push({ path, body });
    return result;
  };
  post.calls = calls;
  return post;
}

const ENV = { url: 'http://x', token: 't', pathPrefix: '', userId: '' };

test('test_detects_traceback_and_searches — output com Traceback → /v1/recall com a linha de erro', async () => {
  const post = stubPost({ results: [{ text: 'esse erro foi um venv faltando', id: 'a' }] });
  const input = {
    tool_input: { command: 'python run.py' },
    tool_response: {
      stdout: '',
      stderr:
        'Traceback (most recent call last):\n  File "run.py", line 3, in <module>\n    import numpy\nModuleNotFoundError: No module named numpy',
    },
  };
  const out = await buildToolContext({ input, post, env: ENV });
  assert.equal(post.calls.length, 1);
  assert.equal(post.calls[0].path, '/v1/recall');
  // a query é a linha de erro específica (a última do traceback), não o traceback inteiro
  assert.match(post.calls[0].body.query, /ModuleNotFoundError: No module named numpy/);
  const parsed = JSON.parse(out);
  assert.equal(parsed.hookSpecificOutput.hookEventName, 'PostToolUse');
  assert.match(parsed.hookSpecificOutput.additionalContext, /venv faltando/);
});

test('test_skips_short_output — output < 50 chars não chama post', async () => {
  const post = stubPost();
  const input = { tool_input: { command: 'ls' }, tool_response: { stdout: 'file.txt', stderr: '' } };
  const out = await buildToolContext({ input, post, env: ENV });
  assert.equal(post.calls.length, 0);
  assert.equal(out, null);
});

test('test_skips_git_commit — comando git commit não busca (não é bug reproduzível)', async () => {
  const post = stubPost();
  const input = {
    tool_input: { command: 'git commit -m "fix"' },
    tool_response: {
      stdout: '',
      stderr: 'error: pathspec did not match — some long enough error output to pass the 50 char gate here',
    },
  };
  const out = await buildToolContext({ input, post, env: ENV });
  assert.equal(post.calls.length, 0);
  assert.equal(out, null);
});

test('test_skips_success_output — output longo mas SEM sinal de erro → sem busca', async () => {
  const post = stubPost();
  const input = {
    tool_input: { command: 'npm run build' },
    tool_response: { stdout: 'Build completed successfully in 12s. 240 modules transformed and written to dist.', stderr: '' },
  };
  const out = await buildToolContext({ input, post, env: ENV });
  assert.equal(post.calls.length, 0);
  assert.equal(out, null);
});

test('test_skips_without_token — token null → não busca (EC-2, defesa da invariante)', async () => {
  const post = stubPost();
  const input = {
    tool_input: { command: 'python run.py' },
    tool_response: { stderr: 'Traceback (most recent call last):\nRuntimeError: something broke badly here now' },
  };
  const out = await buildToolContext({ input, post, env: { ...ENV, token: null } });
  assert.equal(post.calls.length, 0);
  assert.equal(out, null);
});

test('test_no_context_on_empty_recall — erro detectado mas recall vazio → não injeta nada', async () => {
  const post = stubPost({ results: [] });
  const input = {
    tool_input: { command: 'cargo build' },
    tool_response: { stderr: 'error[E0433]: failed to resolve: use of undeclared crate or module `foo` in this scope' },
  };
  const out = await buildToolContext({ input, post, env: ENV });
  assert.equal(post.calls.length, 1); // buscou
  assert.equal(out, null); // mas nada relevante → não injeta
});
