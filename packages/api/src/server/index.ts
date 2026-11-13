/**
 * Public factory for `@usetheo/memory/server`.
 *
 * Per ADR D11: `createServer({ memory, authVerifier? })` consumes the
 * `Memory` interface via DI. Caller wires `createMemory({ ... })` →
 * `createServer({ memory })`. No `createServerWithMemory` shortcut.
 *
 * @see Plan theo-memory-standalone-p0 § ADR D11
 */
export { createApp as createServer } from './app.js';
export type { AdminApiOptions, CreateServerOptions } from './app.js';
export { createAmlAdapter } from './aml-adapter.js';
export type { AmlAdapterOptions } from './aml-adapter.js';

// Camada 1 (env-secret) — historical default
export { BearerAuthVerifier, readApiKey } from './auth/bearer-verifier.js';
export { bearerAuth, parseRequireCredentialEnv } from './auth/middleware.js';

// Camada 2 (OSS multi-user lifecycle per ADR-0014) — F-dom-api-1 fix
// Re-exports so third-party SDK consumers can compose admin REST OR a
// custom dual-validation wiring without internal subpath imports.
export { ApiKeyAuthVerifier } from './auth/api-key-verifier.js';
export type { AuthPool } from './auth/api-key-verifier.js';
export { requireScope } from './auth/scope-verifier.js';
export type { RequireScopeOptions } from './auth/scope-verifier.js';
export { isBootstrapAllowed, markBootstrapConsumedTx } from './auth/bootstrap-token.js';

// Camada 3 (OIDC bridge per ADR-0013) — F-dom-api-1 fix
export { OidcAuthVerifier } from './auth/oidc-verifier.js';
export type {
  IntrospectFn,
  IntrospectionResult,
  OidcAuthVerifierOptions,
} from './auth/oidc-verifier.js';
export { dualValidationAuth } from './auth/dual-validation.js';
export type { DualValidationOptions } from './auth/dual-validation.js';
export { createOauth4webapiIntrospect } from './auth/oidc-introspect-oauth4webapi.js';
export type { CreateOauth4webapiIntrospectOptions } from './auth/oidc-introspect-oauth4webapi.js';

// RFC 9728 (well-known oauth-protected-resource per ADR-0015 #4)
export { wellKnownOauthProtectedResourceHandler } from './handlers/well-known.js';
export type { OidcDiscoveryConfig } from './handlers/well-known.js';

// RBAC (multi-tenant-rbac-and-slice1-completion T4.1) — the members/roles surface
// so a third-party SDK consumer composing a custom server can role-gate routes +
// back `/v1/members` without reaching into internal subpaths. The role primitives
// (`WorkspaceRole`, `roleSatisfies`, `DEFAULT_OWNER_USER_ID`) are convenience
// re-exports from the core contract barrel (`@usetheo/memory/contract`).
export { requireRole, requireScopeOnPrincipal } from './auth/middleware.js';
export {
  createInMemoryMembersRepository,
  isWorkspaceRole,
} from './store/members-store.js';
export type {
  MembersRepository,
  Member,
  AddMemberResult,
  SetRoleResult,
  RemoveMemberResult,
} from './store/members-store.js';
export { createPostgresMembersRepository } from './store/members-store-pg.js';
export { roleSatisfies, DEFAULT_OWNER_USER_ID } from '@usetheo/memory/contract';
export type { WorkspaceRole } from '@usetheo/memory/contract';
