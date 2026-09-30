/**
 * The OAuth-protected MCP transport against real Postgres (usetheoai/theo#477).
 *
 * Two properties the unit suites cannot prove, because both live in the database:
 *
 *  1. The MCP path refuses to serve when its request role ignores row-level security — a
 *     superuser would make every isolation layer above it report success while isolating
 *     nothing.
 *  2. A tool call made with a token for tenant A writes into tenant A and nowhere else, and a
 *     token for tenant B cannot read it back. The request goes over real HTTP, through the
 *     real JWT gate (RS256 token, in-process JWKS), into the real tenant-scoped pool, under
 *     the contained `themory_app` role.
 */
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { createLocalMemory, PgvectorStore, requireStrictWorkspaceWrites } from '@usetheo/memory';
import type { LLM, LLMResponse, Message } from '@usetheo/memory';
import { DeterministicStubEmbedder } from '@usetheo/memory/embedders/stub';

import {
  createJwtAccessTokenVerifier,
  loadResourceServerConfig,
} from '../../../packages/mcp/src/auth/oauth-resource-server.js';
import { McpServer } from '../../../packages/mcp/src/server.js';
import { openTenantScopedPools } from '../../../packages/mcp/src/tenant-pool.js';
import type { TenantScopedPools } from '../../../packages/mcp/src/tenant-pool.js';
import { connectStreamableHttp } from '../../../packages/mcp/src/transports/streamable-http.js';
import type { StreamableHttpHandle } from '../../../packages/mcp/src/transports/streamable-http.js';

import { createIsolatedDb } from '../_helpers/isolated-db.js';
import type { IsolatedDb } from '../_helpers/isolated-db.js';

const PG_URI = process.env['THEOMEM_PG_URI'];
const ISSUER = 'https://auth.test.example/';
const KID = 'it-key-1';

const emptyJsonLlm: LLM = {
  async generateResponse(): Promise<string> {
    return Promise.resolve('[]');
  },
  async generateChat(_messages: readonly Message[]): Promise<LLMResponse> {
    return Promise.resolve({ content: '[]', role: 'assistant' });
  },
};

function resultsOf(r: unknown): unknown[] {
  const sc = (r as { structuredContent?: { results?: unknown[] } }).structuredContent;
  return sc?.results ?? [];
}

if (PG_URI === undefined || PG_URI === '') {
  describe.skip('MCP OAuth tenant isolation (THEOMEM_PG_URI not set)', () => {
    test('placeholder', () => {
      /* no-op */
    });
  });
} else {
  describe('MCP path — request role must be contained by row-level security', () => {
    let iso: IsolatedDb;

    beforeAll(async () => {
      iso = await createIsolatedDb();
    }, 30_000);

    afterAll(async () => {
      await iso.dropDb();
    });

    test('test_mcp_path_refuses_to_start_as_a_superuser', async () => {
      await expect(
        openTenantScopedPools({ pgUri: iso.setupUri, skipMigrations: true, embeddingDim: 384 }),
      ).rejects.toThrow(/row-level security[\s\S]*themory_app/);
    });

    test('test_mcp_path_starts_as_the_contained_application_role', async () => {
      const pools = await openTenantScopedPools({ pgUri: iso.uri, skipMigrations: true, embeddingDim: 384 });
      try {
        expect(pools.role).toBe('themory_app');
      } finally {
        await pools.end();
      }
    });
  });

  describe('MCP path — a token writes into its own tenant only', () => {
    let iso: IsolatedDb;
    let pools: TenantScopedPools;
    let jwksServer: Server;
    let handle: StreamableHttpHandle;
    let signingKey: Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];
    let resource: string;
    const TENANT_A = `tn-a-${randomUUID()}`;
    const TENANT_B = `tn-b-${randomUUID()}`;
    const CANARY = `tenant A canary ${randomUUID()}`;

    async function tokenFor(tenantId: string): Promise<string> {
      return new SignJWT({ tenant_id: tenantId })
        .setProtectedHeader({ alg: 'RS256', kid: KID, typ: 'at+jwt' })
        .setIssuer(ISSUER)
        .setAudience(resource)
        .setSubject('user-alice')
        .setIssuedAt()
        .setExpirationTime('5m')
        .sign(signingKey);
    }

    async function connectAs(tenantId: string): Promise<Client> {
      const client = new Client({ name: 'oauth-it', version: '1.0.0' });
      const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${String(handle.port)}/`), {
        requestInit: { headers: { authorization: `Bearer ${await tokenFor(tenantId)}` } },
      });
      await client.connect(transport);
      return client;
    }

    beforeAll(async () => {
      iso = await createIsolatedDb();
      const pair = await generateKeyPair('RS256', { extractable: true });
      signingKey = pair.privateKey;
      const jwk = { ...(await exportJWK(pair.publicKey)), kid: KID, alg: 'RS256' };
      jwksServer = createServer((_req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ keys: [jwk] }));
      });
      await new Promise<void>((resolve) => jwksServer.listen(0, '127.0.0.1', resolve));
      const jwksPort = (jwksServer.address() as AddressInfo).port;

      // The composition runMcpServer performs on the OAuth path, minus the real providers.
      pools = await openTenantScopedPools({ pgUri: iso.uri, skipMigrations: true, embeddingDim: 384 });
      const memory = await createLocalMemory({
        vectorStore: new PgvectorStore(pools.pool),
        embedder: new DeterministicStubEmbedder(),
        llm: emptyJsonLlm,
      });
      requireStrictWorkspaceWrites();

      // Resource URI is fixed before the listener binds; the gate compares it to `aud`, not
      // to the listener's own address.
      resource = 'https://app.test.example/mcp/memory';
      const config = loadResourceServerConfig({
        THEO_MCP_RESOURCE: resource,
        THEO_OAUTH_ISSUER: ISSUER,
        THEO_OAUTH_JWKS_URI: `http://127.0.0.1:${String(jwksPort)}/jwks.json`,
      });
      handle = await connectStreamableHttp(
        () => new McpServer({ name: 'themory', version: 'it', memoryFactory: () => memory }),
        {
          port: 0,
          host: '127.0.0.1',
          oauth: { config, verifier: createJwtAccessTokenVerifier(config), logWarn: () => undefined },
        },
      );
    }, 60_000);

    afterAll(async () => {
      await handle?.close();
      await new Promise<void>((resolve) => jwksServer?.close(() => resolve()));
      await pools?.end();
      await iso?.dropDb();
    });

    test('test_tool_call_writes_into_the_token_tenant_only', async () => {
      const alice = await connectAs(TENANT_A);
      try {
        const result = await alice.callTool({ name: 'remember', arguments: { content: CANARY, infer: false } });
        expect(result.isError).not.toBe(true);
      } finally {
        await alice.close();
      }

      // Read across workspaces through the NAMED crossing policy, never as a superuser.
      const cross = iso.crossWorkspacePool('verify which workspace an MCP write landed in');
      const rows = await cross.query<{ workspace_id: string; n: string }>(
        'SELECT workspace_id, count(*)::text AS n FROM memories GROUP BY workspace_id',
      );
      expect(rows.rows).toEqual([{ workspace_id: TENANT_A, n: '1' }]);
    });

    test('test_another_tenant_token_cannot_read_it_back', async () => {
      const bob = await connectAs(TENANT_B);
      try {
        const recall = await bob.callTool({ name: 'recall', arguments: { query: CANARY } });
        expect(resultsOf(recall)).toHaveLength(0);
      } finally {
        await bob.close();
      }

      const alice = await connectAs(TENANT_A);
      try {
        const recall = await alice.callTool({ name: 'recall', arguments: { query: CANARY } });
        expect(resultsOf(recall).length).toBeGreaterThanOrEqual(1);
      } finally {
        await alice.close();
      }
    });
  });
}
