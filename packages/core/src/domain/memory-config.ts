/**
 * Construction-time configuration contracts for the local + cloud runtimes.
 *
 * Split out of `memory-store.ts` (2026-07-23, session-separation fix) purely for
 * module-size hygiene — `memory-store.ts` keeps the behavioral contracts
 * (MemoryStore / ScopedMemory / Memory) and re-exports these types so existing
 * importers are unchanged.
 */
import type { Embedder } from './dip/embedder.js';
import type { HistoryManager } from './dip/history-manager.js';
import type { LLM } from './dip/llm.js';
import type { ReflectionPolicy } from './dip/reflection-policy.js';
import type { VectorStore } from './dip/vector-store.js';
import type { Ontology, OntologyName } from './ontology.js';

/**
 * Construction-time config shared by local + cloud runtimes.
 * v0.1 ships createMemory(config: MemoryConfig): Memory factory.
 *
 * @see ADR-0007 — entityBoost default `true`
 */
export interface MemoryConfig {
  readonly embedder: Embedder;
  readonly llm: LLM;
  readonly vectorStore: VectorStore;

  /**
   * Where remember, forget, reflect and supersede record their audit rows. Under
   * `createLocalMemory` over a `PgvectorStore`, omitting the key records into the store's own
   * `history` table (#236); passing `historyManager: undefined` explicitly records nothing.
   */
  readonly historyManager?: HistoryManager | undefined;

  /**
   * Optional. v0.0 shipped ManualReflectionPolicy as the only built-in; v0.4a
   * added ThresholdReflectionPolicy + SleepTimeReflectionPolicy behind the
   * same DIP.
   *
   * Behavior under `createLocalMemory` (ADR-0005 v1.1 supplementary
   * amendment, locked by verbs-as-cli-fixes-cycle-1 T1.1):
   * - **Key OMITTED** → factory defaults to `{ kind: 'manual', shouldReflect: () => Promise.resolve(true) }`.
   *   `reflect()` succeeds without explicit wiring.
   * - **Explicit `undefined` (key present)** → preserves the ADR-0005 v1.0
   *   `ReflectionNotConfigured` throw on the first `reflect()` call. Use this
   *   path when consumer code MUST fail loudly on missing-policy. Type
   *   widened to `ReflectionPolicy | undefined` by verbs-as-cli-fixes-cycle-2
   *   ADR D3 so this opt-in is typed-reachable under
   *   `exactOptionalPropertyTypes: true`.
   * - **Explicit policy** → factory wires the passed reference (no
   *   substitution); the policy's `onReflectionEnd` hook fires on each
   *   `reflect()` call.
   *
   * @see ADR-0005 § Supplementary amendment v1.1 — the runtime distinction
   * @see src/local/__tests__/factory.test.ts § EC-2 paths a/b/c — locks the 3 paths
   */
  readonly reflectionPolicy?: ReflectionPolicy | undefined;

  /** Default `true`. When `false`, no entity vector store is instantiated; halves storage cost. @see ADR-0007 */
  readonly entityBoost?: boolean;

  /** Optional system-prompt prefix injected into LLM extraction calls (upstream-pipeline parity). */
  readonly customInstructions?: string;

  /**
   * Optional domain ontology (Roadmap Item 15). A built-in registry key
   * (`'medical' | 'legal' | 'code' | 'support'`) OR a custom `Ontology` object.
   * When set, the domain entity/relation vocabulary is injected into the
   * extraction prompt + the LLM's entity types are validated post-parse
   * (out-of-vocab → `OTHER`, observable via `ontology_type_coerced`). Persisted
   * in the existing `entities.type` columns — no new store, no migration.
   * Resolved + validated at factory time (`InvalidOntology` on a bad key/object);
   * absent = current generic extraction (byte-unchanged).
   *
   */
  // `OntologyName | (string & {})` keeps autocomplete for the 4 built-in keys
  // while accepting any string (e.g. a dynamic value from env/config); an
  // unknown key fail-fasts with `InvalidOntology` at the factory.
  readonly ontology?: Ontology | OntologyName | (string & {});
}

/**
 * Cloud-runtime extension. Adds optional apiKey + baseUrl over MemoryConfig.
 * v0.5 ships createCloudMemory(config: CloudMemoryConfig): Memory factory.
 *
 * @see ADR-0009 — cloud auth: THEOKIT_API_KEY env var by default; apiKey constructor override.
 */
export interface CloudMemoryConfig extends MemoryConfig {
  /** Overrides `THEOKIT_API_KEY` env var when set. */
  readonly apiKey?: string;

  /** Cloud endpoint base URL. Defaults to TheoCloud production; override for dev / staging. */
  readonly baseUrl?: string;
}
