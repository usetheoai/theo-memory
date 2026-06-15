/**
 * Public barrel for `@usetheo/memory-agent-core`.
 *
 * Shared agent-runtime helpers consumed by BOTH the CLI (`@usetheo/memory-cli`,
 * the `themory` entrypoint) and the MCP server (`@usetheo/memory-mcp`). Extracted
 * to this leaf package (depends ONLY on `@usetheo/memory` + pg + zod) to break the
 * former `cli ↔ mcp` import cycle: previously `mcp` imported these helpers from the
 * cli via the phantom `@usetheo/memory/agent-tools` subpath (which resolved only via
 * build-time shims, not Node `exports`). See ADR D3 of
 * `.claude/knowledge-base/plans/complete-workspace-publish-topology-plan.md`.
 *
 * NOTE (public surface, breaking — pre-release): the previously-documented
 * `@usetheo/memory/agent-tools` subpath is REDEFINED to this package. Core
 * (`@usetheo/memory`) cannot re-export a leaf without re-introducing a cycle, so the
 * agent-tools helpers ship as `@usetheo/memory-agent-core`.
 */
export * from './scope.js';
export * from './agent-tools-memory.js';
export * from './oidc-cli-resolver.js';
export * from './error-classifier.js';
export * from './types.js';
