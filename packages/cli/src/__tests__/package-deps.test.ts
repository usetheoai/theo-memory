/**
 * Package manifest assertions for v0.3 agent-tools MCP server deps.
 *
 * Plan reference: T0.1 — bump zod + add @modelcontextprotocol/sdk + zod-to-json-schema
 * ADRs cited: D1 (transport — SDK), D2 (schema — zod-to-json-schema), D7 (deps absorption)
 * Blueprint Q2 evidence: SDK peer-dep `zod ^3.25 || ^4.0`.
 *
 * RED phase: tests MUST fail against current package.json (zod ^3.24 + no SDK + no zod-to-json-schema).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, test } from 'vitest';

const PACKAGE_JSON = JSON.parse(
  readFileSync(resolve(__dirname, '..', '..', '..', '..', 'package.json'), 'utf-8'),
) as { dependencies?: Record<string, string> };

describe('@usetheo/memory v0.3 — package.json runtime deps (T0.1)', () => {
  test('zod range satisfies @modelcontextprotocol/sdk peer-dep ^3.25 || ^4.0', () => {
    // Given: SDK v1.29.0 declares peerDependency `zod: ^3.25 || ^4.0` per blueprint Q2.
    // When: we read the declared zod range in our manifest.
    const zodRange = PACKAGE_JSON.dependencies?.['zod'];
    // Then: it must be ^3.25.0 (lowest range satisfying SDK peer-dep with zod 3 line).
    expect(zodRange).toBe('^3.25.0');
  });

  test('@modelcontextprotocol/sdk is declared as runtime dep at ^1.32.2', () => {
    // Per ADR D1 (transport) + Blueprint Q2. 1.32 is the first line without the CVEs the image
    // gate refused on 2026-11-12 (#260); tests/integration/image-dependency-floors.test.ts holds
    // the lockfile to it.
    const sdkRange = PACKAGE_JSON.dependencies?.['@modelcontextprotocol/sdk'];
    expect(sdkRange).toBe('^1.32.2');
  });

  test('zod-to-json-schema is declared as runtime dep at ^3.x', () => {
    // Per ADR D2 (schema codegen) + ADR D9 (dialect lock).
    const ztjsRange = PACKAGE_JSON.dependencies?.['zod-to-json-schema'];
    expect(ztjsRange).toBeDefined();
    expect(ztjsRange).toMatch(/^\^3\./);
  });
});
