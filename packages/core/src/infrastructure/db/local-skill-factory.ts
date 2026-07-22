/**
 * Skill-memory factory helpers extracted from `local-memory.ts` (M8 T0-b refactor —
 * keep local-memory.ts under the 300-LoC budget). `this`-free: the `LocalMemory`
 * methods delegate here, passing config + workspace + the forget/get delegates.
 * Behavior is byte-identical to the former `LocalMemory.skills` /
 * `LocalMemory.listSkillsBySubject` methods.
 */
import type { VectorStore } from '../../domain/dip/vector-store.js';
import { InvalidScope } from '../../domain/errors.js';
import type { MemoryItem } from '../../domain/memory-item.js';
import type { RepoScope } from '../../domain/scope.js';
import type {
  ScopedSkillMemory,
  SkillsBySubjectOptions,
  SkillsBySubjectPage,
  SkillWithRepo,
} from '../../domain/skill.js';

import type { LocalMemoryConfig } from './config.js';
import { LocalScopedSkillMemory } from './scoped-skill-memory.js';
import type { VectorStoreWithSkillInsert } from './skill-store-args.js';
import { decodeSkillPayload } from './skills/payload.js';

/**
 * v0.6: build a `LocalScopedSkillMemory` bound to `repoId`. The forget/get
 * delegates route through the canonical `LocalMemory.forget` / `.get` paths
 * (history event + pre-delegate scope-isolation guard) — passed by the caller so
 * this factory stays `this`-free.
 */
export function makeScopedSkillMemory(
  config: LocalMemoryConfig,
  workspaceId: string | undefined,
  forgetDelegate: (id: string) => Promise<void>,
  getDelegate: (id: string) => Promise<MemoryItem | null>,
  repoId: string,
): ScopedSkillMemory {
  // The local stores implement the VectorStoreWithSkillInsert extension as
  // duck-typed methods (off-DIP); narrow at the boundary.
  const skillStore = config.vectorStore as VectorStore & VectorStoreWithSkillInsert;
  return new LocalScopedSkillMemory(repoId, {
    vectorStore: skillStore,
    embedder: config.embedder,
    llm: config.llm,
    ...(workspaceId !== undefined ? { workspaceId } : {}),
    forgetDelegate,
    getDelegate,
    ...(config.tracer !== undefined ? { tracer: config.tracer } : {}),
    ...(config.skillExecutor !== undefined ? { skillExecutor: config.skillExecutor } : {}),
  });
}

/**
 * skills-cross-repo-flat-list (ADR D2/D4) — flat cross-repo skills listing for a
 * subject via the store's tenant-safe prefix scan, decoding each row into a
 * `SkillWithRepo` (the `agent_id` with the `'{subject}:'` prefix stripped).
 */
export async function listSkillsBySubjectImpl(
  config: LocalMemoryConfig,
  workspaceId: string | undefined,
  subject: string,
  options?: SkillsBySubjectOptions,
): Promise<SkillsBySubjectPage> {
  if (subject.length === 0) {
    throw new InvalidScope('listSkillsBySubject requires a non-empty subject');
  }
  // The ':' delimiter is the namespace separator; a subject carrying it would
  // produce an ambiguous prefix → reject (tenant-safety, Drawback #2).
  if (subject.includes(':')) {
    throw new InvalidScope('listSkillsBySubject subject must not contain ":"');
  }
  const store = config.vectorStore as VectorStore & VectorStoreWithSkillInsert;
  const ws = workspaceId ?? 'default';
  const prefix = `${subject}:`;
  const [rows, total] = await store.listSkillsBySubject({
    workspaceId: ws,
    subject,
    limit: options?.limit ?? 100,
    offset: options?.offset ?? 0,
    includeSuperseded: options?.includeSuperseded === true,
    ...(options?.q !== undefined ? { q: options.q } : {}),
  });
  const skills: SkillWithRepo[] = [];
  for (const r of rows) {
    const agentId = r.payload['agent_id'];
    // Defensive: skip any row whose agent_id lacks the expected prefix (never emit
    // a wrong repoId). Inquebrável Rule 3 — honest over silently-wrong.
    if (typeof agentId !== 'string' || !agentId.startsWith(prefix)) {
      continue;
    }
    const repoId = agentId.slice(prefix.length);
    const scope: RepoScope = { kind: 'repo', repoId };
    const decoded = decodeSkillPayload(r.id, r.payload, scope);
    if (decoded === null) {
      continue;
    }
    const withCreatedAt = r.createdAt !== undefined ? { ...decoded, createdAt: r.createdAt } : decoded;
    skills.push({ ...withCreatedAt, repoId });
  }
  return { skills, total };
}
