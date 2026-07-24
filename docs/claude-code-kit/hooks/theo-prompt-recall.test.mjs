#!/usr/bin/env node
// theo-prompt-recall.test.mjs — T1.1 (M14) TDD: recall por-PROMPT no UserPromptSubmit.
//
// Run: node --test docs/claude-code-kit/hooks/theo-prompt-recall.test.mjs
//
// Testa a função pura `buildRecallContext({ input, post, env })` — o hook injeta
// `post`/`env` reais no main(); o teste injeta stubs. Padrão de injeção de deps
// (DIP) para não bater a rede real.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildRecallContext, detectUserRememberDirective } from './theo-prompt-recall.mjs';

// Stub factory: registra as chamadas a `post` e devolve um resultado canned.
function stubPost(result = { results: [] }) {
  const calls = [];
  const post = async (path, body) => {
    calls.push({ path, body });
    return result;
  };
  post.calls = calls;
  return post;
}

const ENV_WITH_TOKEN = { url: 'http://x', token: 't', pathPrefix: '', userId: '' };

test('test_recall_uses_prompt_as_query — query é o prompt do usuário (não o nome do projeto)', async () => {
  const post = stubPost({ results: [{ text: 'm', id: 'a' }] });
  await buildRecallContext({
    input: { prompt: 'como configuro o retriever hibrido do sistema', cwd: '/p/theo-memory' },
    post,
    env: ENV_WITH_TOKEN,
  });
  assert.equal(post.calls.length, 1);
  assert.equal(post.calls[0].path, '/v1/recall');
  assert.equal(post.calls[0].body.query, 'como configuro o retriever hibrido do sistema');
});

test('test_skips_short_prompt — prompt < 20 chars não chama post', async () => {
  const post = stubPost();
  const out = await buildRecallContext({ input: { prompt: 'oi obrigado' }, post, env: ENV_WITH_TOKEN });
  assert.equal(post.calls.length, 0);
  assert.equal(out, null);
});

test('test_recall_at_exact_skip_boundary — exatamente 20 chars NÃO pula (régua < 20)', async () => {
  const post = stubPost();
  const p = 'x'.repeat(20); // len === 20
  await buildRecallContext({ input: { prompt: p }, post, env: ENV_WITH_TOKEN });
  assert.equal(post.calls.length, 1); // 20 não é < 20 → busca
});

test('test_skips_recall_without_token — token null → não chama post (EC-2, defesa da invariante)', async () => {
  const post = stubPost();
  const out = await buildRecallContext({
    input: { prompt: 'uma pergunta longa o suficiente para passar do limite' },
    post,
    env: { url: 'http://x', token: null, pathPrefix: '', userId: '' },
  });
  assert.equal(post.calls.length, 0);
  assert.equal(out, null);
});

test('test_injects_additionalContext_on_hits — resultados viram hookSpecificOutput', async () => {
  const post = stubPost({ results: [{ text: 'fato relevante', id: 'a' }] });
  const out = await buildRecallContext({
    input: { prompt: 'uma pergunta longa o suficiente para buscar' },
    post,
    env: ENV_WITH_TOKEN,
  });
  const parsed = JSON.parse(out);
  assert.equal(parsed.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
  assert.match(parsed.hookSpecificOutput.additionalContext, /fato relevante/);
});

test('test_passes_sessionId_when_present — session_id do payload vira sessionId no recall (M10 scope)', async () => {
  const post = stubPost();
  await buildRecallContext({
    input: { prompt: 'uma pergunta longa o suficiente para buscar memoria', session_id: 'sess-42' },
    post,
    env: ENV_WITH_TOKEN,
  });
  assert.equal(post.calls[0].body.sessionId, 'sess-42');
});

// M14 T1.2 — the production trigger for USER-authored capture ("remember this" → attributedTo:'user').
test('test_detects_user_remember_directive — "remember this" (EN/PT) → true', () => {
  assert.equal(detectUserRememberDirective('remember this: I prefer dark mode'), true);
  assert.equal(detectUserRememberDirective('lembre disso: eu uso pnpm'), true);
  assert.equal(detectUserRememberDirective('please save this to memory'), true);
});

test('test_ignores_ordinary_prompt — an ordinary request is NOT a capture directive', () => {
  assert.equal(detectUserRememberDirective('how do I configure the hybrid retriever'), false);
  assert.equal(detectUserRememberDirective('what did I say about the deploy'), false);
  assert.equal(detectUserRememberDirective(''), false);
  assert.equal(detectUserRememberDirective(undefined), false);
});
