#!/usr/bin/env node
// theo-onboard.test.mjs — T4.1 (M14) TDD: wizard /onboard idempotente.
//
// Run: node --test docs/claude-code-kit/hooks/theo-onboard.test.mjs
//
// Importa o contexto do projeto (CLAUDE.md / AGENTS.md) como memórias de perfil, UMA vez.
// Idempotência por hash de conteúdo (padrão do kit de referência): re-rodar com o mesmo
// conteúdo não duplica. Scope (workspace,user) do Principal server-side (ADR-M14-1) — o hook
// só manda o conteúdo, NUNCA identidade no body. Injeção de deps (DIP) para stubar rede + hash-store.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { runOnboard, hashContent } from './theo-onboard.mjs';

function stubPost(result = { items: [{ id: 'a' }] }) {
  const calls = [];
  const post = async (path, body) => {
    calls.push({ path, body });
    return result;
  };
  post.calls = calls;
  return post;
}

const ENV = { url: 'http://x', token: 't', pathPrefix: '', userId: '' };
const FILES = [{ path: 'CLAUDE.md', content: 'Este projeto usa TypeScript estrito e testes TDD.' }];

test('test_onboard_imports_claude_md — CLAUDE.md presente → post(/v1/remember) 1 vez', async () => {
  const post = stubPost();
  const { imported } = await runOnboard({ files: FILES, post, env: ENV, seen: new Set() });
  assert.equal(post.calls.length, 1);
  assert.equal(post.calls[0].path, '/v1/remember');
  assert.match(post.calls[0].body.content, /TypeScript estrito/);
  assert.equal(imported.length, 1);
});

test('test_onboard_idempotent — 2ª execução com conteúdo idêntico → post 0 vezes (hash)', async () => {
  const post = stubPost();
  const h = hashContent(FILES[0].content);
  const { imported } = await runOnboard({ files: FILES, post, env: ENV, seen: new Set([h]) });
  assert.equal(post.calls.length, 0); // já importado → pula
  assert.equal(imported.length, 0);
});

test('test_onboard_scoped_to_principal — o body NÃO carrega identidade (vem do Principal server-side)', async () => {
  const post = stubPost();
  await runOnboard({ files: FILES, post, env: ENV, seen: new Set() });
  const body = post.calls[0].body;
  assert.equal(body.user_id, undefined);
  assert.equal(body.userId, undefined);
  assert.equal(body.workspace_id, undefined);
  assert.equal(body.workspaceId, undefined);
});

test('test_onboard_imports_both_files — CLAUDE.md + AGENTS.md → 2 imports com hashes distintos', async () => {
  const post = stubPost();
  const files = [
    { path: 'CLAUDE.md', content: 'contrato do projeto A' },
    { path: 'AGENTS.md', content: 'convenções de agentes B' },
  ];
  const { imported, seen } = await runOnboard({ files, post, env: ENV, seen: new Set() });
  assert.equal(post.calls.length, 2);
  assert.equal(imported.length, 2);
  assert.equal(seen.size, 2); // ambos os hashes agora conhecidos
});

test('test_onboard_skips_without_token — token null → não importa (EC-2)', async () => {
  const post = stubPost();
  const { imported } = await runOnboard({ files: FILES, post, env: { ...ENV, token: null }, seen: new Set() });
  assert.equal(post.calls.length, 0);
  assert.equal(imported.length, 0);
});

test('test_onboard_skips_empty_content — arquivo vazio/whitespace → não importa', async () => {
  const post = stubPost();
  const { imported } = await runOnboard({
    files: [{ path: 'CLAUDE.md', content: '   \n  ' }],
    post,
    env: ENV,
    seen: new Set(),
  });
  assert.equal(post.calls.length, 0);
  assert.equal(imported.length, 0);
});
