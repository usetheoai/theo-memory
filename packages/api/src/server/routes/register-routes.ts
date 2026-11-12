/**
 * REST composition — route stage (M6 T1.1 SRP extraction).
 *
 * Mounts every route in the exact pre-refactor order (load-bearing per
 * EC-19/EC-7 + ADR D3): auth-exempt health/version/well-known → admin
 * `requireScope` → `bearerAuth` → members (`requireRole`) → data/verb/skill
 * routes (`requireScopeOnPrincipal`). The bearer middleware stays in the middle
 * so the admin sub-app resolves theo_live_* keys via its own SHA-256 lookup
 * before the generic env-secret bearer fires. Behavior is byte-for-byte the
 * old `createApp` body; this module only relocates it.
 *
 * @see Plan claude-code-memory-integration-plan § M6 T1.1
 */
import type { OpenAPIHono } from '@hono/zod-openapi';
import type { Memory } from '@usetheo/memory/contract';
import type { Context } from 'hono';

import type { AdminApiOptions, CreateServerOptions } from '../app.js';
import { bearerAuth, requireRole, requireScopeOnPrincipal } from '../auth/middleware.js';
import { requireScope } from '../auth/scope-verifier.js';
import {
  createKeyHandler,
  lineageKeyHandler,
  listKeysHandler,
  revokeKeyHandler,
  rotateKeyHandler,
} from '../handlers/admin-keys.js';
import { entitiesHandler } from '../handlers/entities.js';
import { episodesHandler } from '../handlers/episodes.js';
import { forgetHandler } from '../handlers/forget.js';
import { graphHandler } from '../handlers/graph.js';
import { healthDbHandler, healthHandler } from '../handlers/health.js';
import {
  addMemberHandler,
  listMembersHandler,
  removeMemberHandler,
  setMemberRoleHandler,
} from '../handlers/members.js';
import { memoryEvidenceHandler } from '../handlers/memory-evidence.js';
import { getMemoryJob, submitMemoryJob, retryMemoryJob } from '../handlers/memory-jobs.js';
import { messagesSearchHandler } from '../handlers/messages-search.js';
import { metricsHandler } from '../handlers/metrics.js';
import { recallTracesHandler } from '../handlers/recall-traces.js';
import { recallHandler } from '../handlers/recall.js';
import { reflectHandler } from '../handlers/reflect.js';
import { batchRememberHandler, rememberHandler } from '../handlers/remember.js';
import {
  getRoutingPolicyHandler,
  putRoutingPolicyHandler,
  getRoutingAuditHandler,
} from '../handlers/routing-governance.js';
import { scopedForgetHandler } from '../handlers/scoped-forget.js';
import { scopesHandler } from '../handlers/scopes.js';
import { sessionsHandler } from '../handlers/sessions.js';
import {
  deleteSkillHandler,
  executeSkillHandler,
  postSkillHandler,
  skillsAllHandler,
  skillsHandler,
} from '../handlers/skills.js';
import { versionHandler } from '../handlers/version.js';
import { wellKnownOauthProtectedResourceHandler } from '../handlers/well-known.js';
import { workspaceScope } from '../middleware/workspace-scope.js';
import { createPostgresMembersRepository } from '../store/members-store-pg.js';
import type { MembersRepository } from '../store/members-store.js';

/** ADR-0014 D6 — single-tenant OSS variant; subject is the constant `'self'`. */
const ADMIN_SUBJECT = 'self';

// Health + version + RFC 9728 discovery are auth-exempt: orchestrator probes
// and MCP clients hit them BEFORE having credentials, so they mount ahead of
// the bearer middleware (same load-bearing ordering as /v1/openapi.json per
// EC-19). `/v1/healthz` + `/v1/healthz/ready` are M6 T1.1 aliases of the
// existing health pair; `/v1/version` reports build provenance.
function registerAuthExemptRoutes(app: OpenAPIHono, options: CreateServerOptions): void {
  const { dbProbe, readinessProbe, oidcDiscovery } = options;
  app.get('/v1/health', (c) => healthHandler(c, readinessProbe));
  app.get('/v1/health/db', (c) => healthDbHandler(c, dbProbe));
  // B-118 — `/v1/health/ready` is the ecosystem's canonical readiness name (contract D5), and it
  // was the one shape NOT served here. Before this it fell through to the authenticated surface
  // and answered 401, which a probe reads as "unauthorized" rather than "not found" — worse than
  // a 404, because it looks like a credential problem on a healthy service.
  //
  // It answers from `dbProbe`, not `readinessProbe`: pointing the canonical readiness name at the
  // liveness handler would give the ecosystem a route that says "ready" whenever the process is
  // up, which is the failure D5 exists to remove wearing the right name.
  app.get('/v1/health/ready', (c) => healthDbHandler(c, dbProbe));
  // The M6 T1.1 aliases. Kept: they have callers, and the contract's migration is additive —
  // removal is its own item after a deprecation deadline.
  app.get('/v1/healthz', (c) => healthHandler(c, readinessProbe));
  app.get('/v1/healthz/ready', (c) => healthDbHandler(c, dbProbe));
  app.get('/v1/version', versionHandler);
  app.get(
    '/.well-known/oauth-protected-resource',
    wellKnownOauthProtectedResourceHandler(oidcDiscovery),
  );
}

// viaBootstrapToken detection mirrors the integration test's `buildAdminApp`
// pattern: when the Bearer equals the bootstrap token, createKeyHandler runs the
// atomic-tx path (EC-3). ADR D4: consult the MembersRepository DIP for the
// target's role rather than an inline SQL duplicate.
function makeCreateKeyRoute(
  adminApi: AdminApiOptions,
  adminBootstrap: string | undefined,
  membersRepo: MembersRepository | undefined,
): (c: Context) => Promise<Response> {
  return (c) => {
    const header = c.req.header('authorization') ?? c.req.header('Authorization') ?? '';
    const token = header.replace(/^Bearer\s+/i, '');
    const viaBootstrap =
      adminBootstrap !== undefined && adminBootstrap.length > 0 && token === adminBootstrap;
    return createKeyHandler(c, adminApi.pool, ADMIN_SUBJECT, {
      viaBootstrapToken: viaBootstrap,
      ...(membersRepo !== undefined
        ? { getMemberRole: (ws: string, uid: string) => membersRepo.getMemberRole(ws, uid) }
        : {}),
    });
  };
}

// T1.1 + ADR D1 + EC-7 — admin sub-app MUST mount BEFORE the generic bearer.
// requireScope owns its own Bearer extraction + theo_api_keys SHA-256 lookup,
// bypassing the env-secret comparison the generic bearer would apply.
function registerAdminRoutes(
  app: OpenAPIHono,
  adminApi: AdminApiOptions,
  membersRepo: MembersRepository | undefined,
): void {
  const adminBootstrap = adminApi.bootstrapToken;
  app.use('/v1/admin/*', requireScope({
    pool: adminApi.pool,
    requiredScope: 'memory:admin',
    ...(adminBootstrap !== undefined ? { bootstrapToken: adminBootstrap } : {}),
  }));
  app.post('/v1/admin/keys', makeCreateKeyRoute(adminApi, adminBootstrap, membersRepo));
  app.get('/v1/admin/keys/list', (c) => listKeysHandler(c, adminApi.pool, ADMIN_SUBJECT));
  app.delete('/v1/admin/keys/:id', (c) => revokeKeyHandler(c, adminApi.pool, ADMIN_SUBJECT));
  app.post('/v1/admin/keys/:id/rotate', (c) => rotateKeyHandler(c, adminApi.pool, ADMIN_SUBJECT));
  app.get('/v1/admin/keys/:id/lineage', (c) => lineageKeyHandler(c, adminApi.pool, ADMIN_SUBJECT));
}

// RBAC T2.1 — `/v1/members/*` membership management, gated by requireRole.
// Mounted AFTER bearerAuth so the Principal (with role) is injected; handlers
// derive the workspace from the Principal, never the body.
function registerMemberRoutes(app: OpenAPIHono, membersRepo: MembersRepository): void {
  app.get('/v1/members', requireRole('admin'), (c) => listMembersHandler(c, membersRepo));
  app.post('/v1/members', requireRole('admin'), (c) => addMemberHandler(c, membersRepo));
  app.patch('/v1/members/:userId', requireRole('admin'), (c) => setMemberRoleHandler(c, membersRepo));
  app.delete('/v1/members/:userId', requireRole('admin'), (c) => removeMemberHandler(c, membersRepo));
}

// #77 — subject-scoped data routes: GET reads require memory:read, DELETE
// memory:delete. recall-traces is opt-in (mounted only when the store is wired).
function registerScopeRoutes(app: OpenAPIHono, options: CreateServerOptions): void {
  const { memory, usageCounterStore, memoryEntityStore, memoryGraphStore, recallTraceStore, routingPolicyStore, routingAuditStore } =
    options;
  if (options.memoryEvidenceStore !== undefined) {
    const store = options.memoryEvidenceStore;
    app.get('/v1/scopes/:type/:id/memories/:memoryId/evidence', requireScopeOnPrincipal('memory:read'), (c) => memoryEvidenceHandler(c, store));
  }
  app.get('/v1/scopes/:type/:id/memories', requireScopeOnPrincipal('memory:read'), (c) => scopesHandler(c, memory));
  app.get('/v1/scopes/:type/:id/episodes', requireScopeOnPrincipal('memory:read'), (c) => episodesHandler(c, memory));
  app.get('/v1/scopes/:type/:id/messages/search', requireScopeOnPrincipal('memory:read'), (c) => messagesSearchHandler(c, memory));
  // Session-separation fix (2026-07-23): enumerate a user's session sub-scopes.
  app.get('/v1/scopes/:type/:id/sessions', requireScopeOnPrincipal('memory:read'), (c) => sessionsHandler(c, memory));
  app.delete('/v1/scopes/:type/:id/memories/:memId', requireScopeOnPrincipal('memory:delete'), (c) => scopedForgetHandler(c, memory));
  app.get('/v1/scopes/:type/:id/metrics', requireScopeOnPrincipal('memory:read'), (c) => metricsHandler(c, memory, usageCounterStore, memoryEntityStore));
  app.get('/v1/scopes/:type/:id/entities', requireScopeOnPrincipal('memory:read'), (c) => entitiesHandler(c, memory, memoryEntityStore));
  app.get('/v1/scopes/:type/:id/graph', requireScopeOnPrincipal('memory:read'), (c) => graphHandler(c, memoryEntityStore, memoryGraphStore));
  if (recallTraceStore !== undefined) {
    app.get('/v1/recall-traces/:recallId', requireScopeOnPrincipal('memory:read'), (c) => recallTracesHandler(c, recallTraceStore));
  }
  // M11 T3.1 — routing-governance routes (opt-in when the stores are wired). PUT is admin-scoped
  // inside the handler; GET is (workspace, user)-scoped (cross-user → 404, ADR D3).
  if (routingPolicyStore !== undefined) {
    app.get('/v1/routing-policy/:userId', requireScopeOnPrincipal('memory:read'), (c) => getRoutingPolicyHandler(c, routingPolicyStore));
    app.put('/v1/routing-policy/:userId', requireScopeOnPrincipal('memory:write'), (c) => putRoutingPolicyHandler(c, routingPolicyStore));
  }
  if (routingAuditStore !== undefined) {
    app.get('/v1/routing-audit/:userId', requireScopeOnPrincipal('memory:read'), (c) => getRoutingAuditHandler(c, routingAuditStore));
  }
}

// Repo-tier skill routes (browse + cross-repo flat list + create/curate/execute).
function registerSkillRoutes(app: OpenAPIHono, memory: Memory): void {
  app.get('/v1/scopes/skill/:repoId/skills', requireScopeOnPrincipal('memory:read'), (c) => skillsHandler(c, memory));
  app.get('/v1/scopes/skill/:subject/all', requireScopeOnPrincipal('memory:read'), (c) => skillsAllHandler(c, memory));
  app.post('/v1/scopes/skill/:repoId/skills', requireScopeOnPrincipal('memory:write'), (c) => postSkillHandler(c, memory));
  app.delete('/v1/scopes/skill/:repoId/skills/:skillId', requireScopeOnPrincipal('memory:delete'), (c) => deleteSkillHandler(c, memory));
  app.post('/v1/scopes/skill/:repoId/skills/:skillId/execute', requireScopeOnPrincipal('memory:write'), (c) => executeSkillHandler(c, memory));
}

// #77 — the 4 verbs: each requires its matching scope on the resolved Principal.
function registerVerbRoutes(app: OpenAPIHono, options: CreateServerOptions): void {
  const { memory, routingAuditStore } = options;
  app.post('/v1/remember', requireScopeOnPrincipal('memory:write'), (c) => rememberHandler(c, memory, routingAuditStore));
  // M6 T1.3 — batch remember (array body → per-item scoped.remember; one request,
  // N facts, one write-limiter slot). Same memory:write scope as /v1/remember.
  app.post('/v1/remember/batch', requireScopeOnPrincipal('memory:write'), (c) => batchRememberHandler(c, memory, routingAuditStore));
  app.post('/v1/recall', requireScopeOnPrincipal('memory:read'), (c) => recallHandler(c, memory));
  app.post('/v1/forget', requireScopeOnPrincipal('memory:delete'), (c) => forgetHandler(c, memory));
  app.post('/v1/reflect', requireScopeOnPrincipal('memory:write'), (c) => reflectHandler(c, memory));
}

/**
 * Mount every route in the load-bearing order. The membership repo is
 * constructed once and shared by the key-mint anti-escalation lookup and the
 * `/v1/members` routes. bearerAuth mounts between the admin sub-app and the
 * member/data routes — do not reorder.
 */
export function registerRoutes(app: OpenAPIHono, options: CreateServerOptions): void {
  const { authVerifier, requireCredential, adminApi } = options;
  const membersRepo: MembersRepository | undefined =
    options.membersRepository ??
    (adminApi !== undefined ? createPostgresMembersRepository(adminApi.pool) : undefined);

  registerAuthExemptRoutes(app, options);
  if (adminApi !== undefined) {
    registerAdminRoutes(app, adminApi, membersRepo);
  }
  app.use('/v1/*', bearerAuth(authVerifier, { requireCredential: requireCredential === true }));
  // Immediately after the Principal is resolved, and before any route can touch
  // the database: bind the workspace so PostgreSQL enforces the boundary itself
  // (migration 0029). Ordering is the security property — a scope taken from
  // caller input instead of the Principal would let a client name someone
  // else's workspace and have RLS faithfully honour it.
  app.use('/v1/*', workspaceScope());
  if (membersRepo !== undefined) {
    registerMemberRoutes(app, membersRepo);
  }
  registerScopeRoutes(app, options);
  registerSkillRoutes(app, options.memory);
  if (options.memoryJobs !== undefined) {
    const jobs = options.memoryJobs;
    app.post('/v1/memory-jobs', requireScopeOnPrincipal('memory:write'), (c) => submitMemoryJob(c,jobs));
    app.get('/v1/memory-jobs/:jobId', requireScopeOnPrincipal('memory:read'), (c) => getMemoryJob(c,jobs));
    app.post('/v1/memory-jobs/:jobId/retry', requireScopeOnPrincipal('memory:write'), (c) => retryMemoryJob(c,jobs));
  }
  registerVerbRoutes(app, options);
}
