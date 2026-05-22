/**
 * Three-tier scope discriminated union and the internal Filters shape.
 *
 * @see ADR-0002 — three-tier scope (User / Session / Agent) via scoped sub-objects.
 * @see ADR-0001 — Mem0-shape architecture (Filters renames Mem0's `run_id` to `session_id`).
 */

export interface UserScope {
  readonly kind: 'user';
  readonly userId: string;
}

export interface SessionScope {
  readonly kind: 'session';
  readonly sessionId: string;
  /** Optional cross-tier filter: pin the session to a specific user. */
  readonly userId?: string;
}

export interface AgentScope {
  readonly kind: 'agent';
  readonly agentId: string;
  /** Optional cross-tier filter: pin the agent invocation to a specific user. */
  readonly userId?: string;
}

export type Scope = UserScope | SessionScope | AgentScope;

/**
 * Internal filter shape passed to the VectorStore + HistoryManager DIPs.
 * Maps 1:1 onto Mem0's `SearchFilters` shape (snake_case keys);
 * `session_id` is the only rename (Mem0 uses `run_id`).
 */
export interface Filters {
  readonly user_id?: string;
  readonly agent_id?: string;
  readonly session_id?: string;
}
