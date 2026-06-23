/**
 * T1.2 — `src/core/index.ts` contract-barrel JSDoc + @see closure test.
 *
 * Mirrors T1.1 (src/index.ts) but for the contract barrel. Each export
 * statement gets a JSDoc block above with at least one `@see` cross-ref
 * per CLAUDE.md § PRIORITY 0 sub-goal 1.
 *
 * EC-13 absorption (DOCUMENT): `@see` targets may be plans, ADRs, or
 * knowledge-base coordinates — any path under `.claude/knowledge-base/`
 * counts as a valid cross-ref.
 *
 * @see .claude/knowledge-base/plans/p0-api-sdk-mcp-correctness-audit-plan.md § T1.2
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..', '..');
const CONTRACT_PATH = join(REPO_ROOT, 'packages', 'core', 'src', 'domain', 'index.ts');

interface ExportBlock {
  readonly startLine: number;
  readonly statementText: string;
}

function findExportBlocks(content: string): ExportBlock[] {
  const blocks: ExportBlock[] = [];
  const lines = content.split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.startsWith('export ')) {
      let stmt = line;
      let j = i;
      while (!stmt.includes(';') && j + 1 < lines.length) {
        j += 1;
        stmt += '\n' + lines[j]!;
      }
      blocks.push({ startLine: i + 1, statementText: stmt });
      i = j + 1;
    } else {
      i += 1;
    }
  }
  return blocks;
}

function findJsdocBlock(content: string, startLine: number): string | null {
  const lines = content.split('\n');
  let idx = startLine - 1;
  while (idx > 0 && lines[idx - 1]!.trim() === '') {
    idx -= 1;
  }
  if (idx <= 0) return null;
  if (!lines[idx - 1]!.includes('*/')) return null;
  let endLine = idx - 1;
  let startLineOfBlock = endLine;
  while (startLineOfBlock >= 0) {
    if (lines[startLineOfBlock]!.includes('/**')) {
      return lines.slice(startLineOfBlock, endLine + 1).join('\n');
    }
    startLineOfBlock -= 1;
  }
  return null;
}

describe('T1.2 — src/core/index.ts contract-barrel JSDoc + @see', () => {
  const content = readFileSync(CONTRACT_PATH, 'utf8');
  const blocks = findExportBlocks(content);

  test('1. src/core/index.ts contains 56 export statements (+ adaptive DIP + graph-expansion DIP)', () => {
    // 54 = 52 (prior: +4 episodes +1 reranker) + 2 ontology exports (Ontology/OntologyName type export + BUILTIN_ONTOLOGIES/resolveOntology value export); earlier: 47 baseline + 4 M2 episodes (M2 v0.14 first-class-episodes:
    // EpisodeListOptions/EpisodePage/EpisodeCursor type export + the
    // EPISODE_LIMIT/cursor-codec value export) + 1 reranker DIP type export
    // (Reranker; cross-encoder-reranker Item 23). The reranker cycle reconciled
    // the M2-episodes surface drift this snapshot had not absorbed.
    // Each has a JSDoc + @see block.
    expect(blocks.length).toBe(56);
  });

  test('2. every export statement has a JSDoc block above', () => {
    const missing: number[] = [];
    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i]!;
      if (findJsdocBlock(content, block.startLine) === null) {
        missing.push(block.startLine);
      }
    }
    expect(missing, `Missing JSDoc above lines: ${missing.join(', ')}`).toHaveLength(0);
  });

  test('3. every export statement JSDoc contains at least one @see cross-reference', () => {
    const missingSee: number[] = [];
    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i]!;
      const jsdoc = findJsdocBlock(content, block.startLine);
      if (jsdoc === null || !/@see/.test(jsdoc)) {
        missingSee.push(block.startLine);
      }
    }
    expect(missingSee, `Missing @see above lines: ${missingSee.join(', ')}`).toHaveLength(0);
  });
});
