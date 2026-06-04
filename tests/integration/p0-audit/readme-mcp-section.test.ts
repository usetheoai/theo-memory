/**
 * T3.4 — README § Agent loops via MCP currency sentinel.
 *
 * Verifies the MCP setup section reflects the post-T3.2 reality (real
 * providers, OPENAI_API_KEY required, .mcp.json registration) instead of
 * the pre-e43d801 stub-default narrative.
 *
 * @see .claude/knowledge-base/plans/p0-api-sdk-mcp-correctness-audit-plan.md § T3.4
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..', '..');
const README_PATH = join(REPO_ROOT, 'README.md');

/**
 * Extract the text between `## Agent loops via MCP` and the next top-level
 * `## ` header. Returns the section body for currency assertions.
 */
function extractMcpSection(readme: string): string {
  const start = readme.indexOf('## Agent loops via MCP');
  if (start === -1) return '';
  const after = readme.slice(start + 1);
  const nextHeaderRel = after.search(/\n## [^#]/);
  if (nextHeaderRel === -1) return readme.slice(start);
  return readme.slice(start, start + 1 + nextHeaderRel);
}

describe('T3.4 — README § Agent loops via MCP currency', () => {
  const readme = readFileSync(README_PATH, 'utf8');
  const section = extractMcpSection(readme);

  test('1. README has a section starting `## Agent loops via MCP`', () => {
    expect(section.length).toBeGreaterThan(0);
  });

  test('2. MCP section documents `OPENAI_API_KEY` requirement (post-T3.2)', () => {
    expect(section).toMatch(/OPENAI_API_KEY/);
  });

  test('3. MCP section does NOT claim "MCP uses stubs" (stale pre-T3.2 narrative)', () => {
    // The phrase "MCP" within close proximity of "Stub" / "stub" + "default"
    // would indicate the stale "alpha default uses stubs" claim. After T3.2,
    // both MCP + REST hard-fail without OPENAI_API_KEY; no silent stub.
    // Search for the specific stale-pattern fragments.
    expect(section).not.toMatch(/MCP\)?\s+wire `DeterministicStubEmbedder`/);
    expect(section).not.toMatch(/MCP[^.]*(uses?|wires?|defaults? to)\s+(Stub|stub)/i);
  });

  test('4. MCP section documents `.mcp.json` (Claude Code project-local mechanism)', () => {
    expect(section).toMatch(/\.mcp\.json/);
  });

  test('5. MCP section names the 4 verbs (remember / recall / forget / reflect)', () => {
    expect(section).toMatch(/remember/);
    expect(section).toMatch(/recall/);
    expect(section).toMatch(/forget/);
    expect(section).toMatch(/reflect/);
  });

  test('6. MCP section documents OPENAI_BASE_URL OpenRouter compatibility', () => {
    expect(section).toMatch(/OPENAI_BASE_URL|openrouter|OpenRouter/);
  });

  test('7. fixes-cycle-1 F-dom-cli-2 — README cross-references .mcp.json.example template', () => {
    expect(readme).toMatch(/\.mcp\.json\.example/);
  });
});
