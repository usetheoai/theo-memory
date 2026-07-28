/**
 * `@usetheo/memory/config` subpath — M25 layered-config public surface.
 *
 * Consumers (the `themory config` CLI, `themory server`, external SDK users)
 * import the resolver + loader + secret helpers from here:
 *
 *   import { loadConfig, isSecretKey } from '@usetheo/memory/config';
 *
 */
export { resolveConfig } from './domain/config/resolve.js';
export type { ConfigLayer, ResolvedConfig } from './domain/config/resolve.js';
export { isSecretKey, maskSecret } from './domain/config/secrets.js';
export { ConfigParseError } from './domain/config/config-error.js';
export {
  loadConfig,
  readGlobalConfig,
  readProjectConfig,
  saveProjectConfig,
  globalConfigPath,
  projectConfigPath,
  KNOWN_CONFIG_KEYS,
  type LoadConfigOptions,
} from './infrastructure/config/load.js';
