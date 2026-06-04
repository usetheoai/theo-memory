/**
 * T3.1b conditional fallback (per plan verbs-as-cli-fixes-cycle-1 § EC-1):
 * side-effect module imported FIRST by cli.ts so the dotenv@17 transitive
 * autoload banner is silenced BEFORE the static import graph triggers any
 * dotenv.config() call. ESM imports evaluate in source-order; this file
 * carries zero own imports so it is a leaf module that runs before
 * commander / run-mcp-server / run-server / verb handlers are loaded.
 *
 * @see .claude/knowledge-base/plans/verbs-as-cli-fixes-cycle-1-plan.md § T3.1b
 */
process.env['DOTENV_CONFIG_QUIET'] = process.env['DOTENV_CONFIG_QUIET'] ?? 'true';
