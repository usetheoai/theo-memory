/**
 * Unit tests for the Claude-Code-memory → theo-memory migration tool
 * (M6 T2.1). Exercises the PURE functions (parse / scrub / map / plan) plus the
 * dry-run-vs-commit HTTP boundary. NO live endpoint is contacted — `fetch` is
 * spied; the live `--commit` integration is a separate skipped stub below.
 *
 * @see scripts/migrate-claude-code-memory.mjs
 */
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  MigrationHttpError,
  importBatch,
  nodeToBatchItem,
  parseNode,
  planMigration,
  runMigration,
  scrub,
} from '../../scripts/migrate-claude-code-memory.mjs';

const FIXTURE_DIR = fileURLToPath(new URL('./fixtures/claude-code-memory', import.meta.url));

// The planted secret. Asserting this exact string NEVER reaches a payload is the
// core security guarantee of the migration (ADR-4, fail-closed scrub).
const PLANTED_SECRET = 'sk-proj-FAKE0000000000000000000000000000000000000000000000';

const NESTED = `---
name: nested-node
description: A project fact with nested metadata type.
metadata:
  node_type: memory
  type: project
  originSessionId: sess-1
---

Nested body content.
`;

const FLAT = `---
name: flat-node
description: A feedback fact with a flat top-level type.
type: feedback
---

Flat body content.
`;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('parseNode — accepts both frontmatter variants', () => {
  it('parses the nested metadata.type variant to type=project', () => {
    const node = parseNode(NESTED, 'nested.md');
    expect(node.type).toBe('project');
    expect(node.description).toBe('A project fact with nested metadata type.');
    expect(nodeToBatchItem(node, { userId: 'proj', project: 'proj' }).category).toBe('project');
  });

  it('parses the flat top-level type variant to type=feedback', () => {
    const node = parseNode(FLAT, 'flat.md');
    expect(node.type).toBe('feedback');
    expect(nodeToBatchItem(node, { userId: 'proj', project: 'proj' }).category).toBe('feedback');
  });

  it('captures [[wikilinks]] from the body as an array', () => {
    const node = parseNode(
      `---\nname: n\ndescription: d\ntype: user\n---\n\nrefs [[some-link]] and [[another-link]].\n`,
      'w.md',
    );
    expect(node.wikilinks).toEqual(['some-link', 'another-link']);
  });
});

describe('scrub — fail-closed secret redaction (ADR-4)', () => {
  it('redacts an OpenAI key and never leaves the raw secret behind', () => {
    const { clean, kinds } = scrub(`config: ${PLANTED_SECRET} end`);
    expect(clean).not.toContain(PLANTED_SECRET);
    expect(clean).toContain('[REDACTED:openai_key]');
    expect(kinds).toContain('openai_key');
  });

  it('flags a private-key block via hadPrivateKey', () => {
    const pk = `-----BEGIN RSA PRIVATE KEY-----\nMIIEabc123FAKE\n-----END RSA PRIVATE KEY-----`;
    const res = scrub(pk);
    expect(res.hadPrivateKey).toBe(true);
    expect(res.clean).not.toContain('BEGIN RSA PRIVATE KEY');
  });

  // M6-SEC-03 — negative cases per new deny-list shape (testing.md § 4.1). Each
  // asserts the specific secret substring is GONE and the precise kind is tagged.
  it.each([
    ['slack_token', 'ping xoxb-2345678901-2345678901234-AbCdEfGhIjKlMnOpQrStUvWx now', 'xoxb-'],
    ['google_api_key', 'key AIzaSyA1234567890abcdefghijklmnopqrstuvw done', 'AIzaSy'],
    ['db_connection_string', 'db postgres://user:S3cretPass@db.example.com:5432/app ok', 'S3cretPass'],
  ])('redacts a %s and leaves no raw secret', (kind, text, rawFragment) => {
    const { clean, kinds } = scrub(text);
    expect(clean).not.toContain(rawFragment);
    expect(clean).toContain(`[REDACTED:${kind}]`);
    expect(kinds).toContain(kind);
  });

  it('redacts the VALUE of a secret-named env assignment, keeping the key visible', () => {
    const { clean, kinds } = scrub('export MY_API_KEY=supersecretvalue123');
    expect(clean).not.toContain('supersecretvalue123');
    expect(clean).toContain('MY_API_KEY=');
    expect(kinds).toContain('secret_assignment');
  });

  it('catches a hyphenated high-entropy token the pure-alnum rule would miss', () => {
    const token = 'ab12-cd34-ef56-gh78-ij90-kl12-mn34-op56';
    const { clean, kinds } = scrub(`reference ${token} here`);
    expect(clean).not.toContain(token);
    expect(kinds).toContain('high_entropy');
  });
});

describe('nodeToBatchItem — MAP shape + provenance', () => {
  it('maps to the batch item with scrubbed text, infer:false and metadata', () => {
    const node = parseNode(
      `---\nname: n\ndescription: A note referencing [[peer]].\ntype: user\n---\n\nbody.\n`,
      'n.md',
    );
    const item = nodeToBatchItem(node, { userId: 'proj', project: 'proj' });
    expect(item.userId).toBe('proj');
    expect(item.infer).toBe(false);
    expect(item.category).toBe('user');
    expect(item.metadata.source).toBe('claude-code');
    expect(item.metadata.project).toBe('proj');
    expect(item.metadata.file).toBe('n.md');
    expect(item.metadata.node_type).toBe('user');
    // wikilinks captured as a comma-joined string (metadata values must be scalar)
    expect(item.metadata.wikilinks).toBe('peer');
  });

  it('NEVER lets a planted secret reach the produced batch item (text or JSON)', () => {
    const node = parseNode(
      `---\nname: n\ndescription: leaked ${PLANTED_SECRET} here\ntype: reference\n---\n\nmore normal body text so the node is not secret-dominated and still imports.\n`,
      'leak.md',
    );
    const item = nodeToBatchItem(node, { userId: 'proj', project: 'proj' });
    expect(item.text).not.toContain(PLANTED_SECRET);
    expect(JSON.stringify(item)).not.toContain(PLANTED_SECRET);
    expect(item.text).toContain('[REDACTED:openai_key]');
  });
});

describe('planMigration — dry-run over the fixture corpus', () => {
  it('imports both frontmatter variants, redacts the leak, skips the all-secret node, skips MEMORY.md', () => {
    const { items, report } = planMigration(FIXTURE_DIR);

    // MEMORY.md is a derivable index — never scanned/imported.
    expect(report.nodes.some((n) => n.file === 'MEMORY.md')).toBe(false);

    const files = items.map((i) => i.metadata.file).sort();
    expect(files).toEqual(['flat.md', 'nested.md', 'secret.md', 'wikilink.md']);

    // the all-secret private-key node is SKIPPED (fail-closed), reported.
    expect(items.some((i) => i.metadata.file === 'allsecret.md')).toBe(false);
    expect(report.skipped.some((s) => s.file === 'allsecret.md')).toBe(true);

    // the planted secret NEVER appears anywhere in the whole outgoing payload.
    expect(JSON.stringify(items)).not.toContain(PLANTED_SECRET);

    // wikilink node's links round-trip into provenance metadata.
    const wl = items.find((i) => i.metadata.file === 'wikilink.md');
    expect(wl?.metadata.wikilinks).toBe('some-link,another-link');

    // every imported item is verbatim (infer:false). Scope note (#109 live E2E): items carry
    // NO userId by default — the gateway's edge-injected X-Theo-User-Id binds the tier (theo-lib
    // parity), so migrated rows land in the SAME scope the kit hooks recall from. The project
    // slug is provenance metadata, never the scope.
    for (const item of items) {
      expect(item.infer).toBe(false);
      expect('userId' in item).toBe(false);
      expect(item.metadata.project).toBe('proj');
    }
  });
});

describe('dry-run vs --commit HTTP boundary', () => {
  it('dry-run performs NO network call (fetch never invoked)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const out = await runMigration({ sourceDir: FIXTURE_DIR, commit: false, endpoint: 'http://dead.invalid' });
    expect(out.committed).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('--commit posts the batch to /v1/remember/batch (fetch IS invoked)', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify({ items: [], imported: 4, deduped: 0, failed: 0 }), {
          status: 201,
          headers: { 'content-type': 'application/json' },
        }),
      );
    const out = await runMigration({
      sourceDir: FIXTURE_DIR,
      commit: true,
      endpoint: 'http://127.0.0.1:8080',
      token: 'theo_live_test',
    });
    expect(out.committed).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe('http://127.0.0.1:8080/v1/remember/batch');
    expect((init as RequestInit).method).toBe('POST');
    expect((init as { headers: Record<string, string> }).headers.authorization).toBe('Bearer theo_live_test');
    // and the planted secret is NOT in the transmitted body.
    expect((init as { body: string }).body).not.toContain(PLANTED_SECRET);
    expect(out.result?.imported).toBe(4);
  });
});

// Kept as executable documentation of the --commit round-trip contract without
// requiring a deployed endpoint in CI.
describe.skipIf(!process.env.THEOMEM_MIGRATE_URL_LIVE)('live --commit round-trip (opt-in)', () => {
  it('imports the fixture batch and dedups on re-run against a real REST', async () => {
    const endpoint = process.env.THEOMEM_MIGRATE_URL_LIVE as string;
    const token = process.env.THEOMEM_MIGRATE_TOKEN;
    const first = await runMigration({ sourceDir: FIXTURE_DIR, commit: true, endpoint, token });
    expect(first.result?.imported).toBeGreaterThan(0);
    const second = await runMigration({ sourceDir: FIXTURE_DIR, commit: true, endpoint, token });
    expect(second.result?.deduped).toBeGreaterThan(0);
  });
});
