#!/usr/bin/env node
// theo-manifest.test.mjs — T4.2 (M14) TDD: manifesto de distribuição (marketplace).
//
// Run: node --test docs/claude-code-kit/hooks/theo-manifest.test.mjs
//
// Espelha o plugin.json + marketplace.json do kit de referência. O manifesto DECLARA os 8
// hooks (4 novos M14 + 4 existentes) e o comando /onboard, para empacotar o kit para
// distribuição. O README menciona /onboard + recall por-prompt.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const kitDir = fileURLToPath(new URL('../', import.meta.url));
const readJson = (rel) => JSON.parse(readFileSync(kitDir + rel, 'utf8'));

const NEW_HOOKS = [
  'theo-prompt-recall.mjs',
  'theo-tool-context.mjs',
  'theo-block-memory-write.mjs',
  'theo-onboard.mjs',
];
const EXISTING_HOOKS = ['theo-recall.mjs', 'theo-remember.mjs', 'theo-precompact.mjs', 'theo-promote.mjs'];

test('test_manifest_lists_all_hooks — plugin.json declara os 8 hooks (4 novos + 4 existentes)', () => {
  const plugin = readJson('.claude-plugin/plugin.json');
  assert.ok(Array.isArray(plugin.hooks), 'plugin.json deve ter um array hooks');
  const files = plugin.hooks.map((h) => h.file);
  assert.equal(plugin.hooks.length, 8);
  for (const name of [...NEW_HOOKS, ...EXISTING_HOOKS]) {
    assert.ok(files.includes(name), `manifesto deve declarar ${name}`);
  }
});

test('test_manifest_declares_onboard_command — o comando /onboard está declarado', () => {
  const plugin = readJson('.claude-plugin/plugin.json');
  assert.ok(Array.isArray(plugin.commands), 'plugin.json deve ter commands');
  const names = plugin.commands.map((c) => c.name);
  assert.ok(names.includes('/onboard'), 'deve declarar o comando /onboard');
});

test('test_marketplace_points_to_plugin — marketplace.json referencia o plugin do kit', () => {
  const market = readJson('.claude-plugin/marketplace.json');
  assert.ok(Array.isArray(market.plugins) && market.plugins.length >= 1);
  assert.ok(market.plugins.some((p) => typeof p.name === 'string' && p.name.length > 0));
});

test('test_readme_mentions_onboard_and_prompt_recall — README documenta /onboard + recall por-prompt', () => {
  const readme = readFileSync(kitDir + 'README.md', 'utf8');
  assert.match(readme, /\/onboard/);
  assert.match(readme, /prompt.?recall|recall por-?prompt|per-prompt recall/i);
});
