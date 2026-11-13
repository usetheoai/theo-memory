import { Pool } from 'pg';
import { createLocalMemory, MemorySession, PgMemoryJobStore, PgvectorStore, assertRequestPoolIsolated, tenantScopedPool, withWorkspaceScope } from '@usetheo/memory';
import { OpenAILLM } from '@usetheo/memory/llms/openai';
import { createWishlistStore } from './facts.mjs';

if (!process.env.THEOMEM_PG_URI) throw new Error('Set THEOMEM_PG_URI to the application role.');
const raw = new Pool({ connectionString: process.env.THEOMEM_PG_URI });
const actor = { workspaceId: 'default', userId: 'alice', role: 'member' };
const mode = process.argv[2] ?? 'context';
try {
  await assertRequestPoolIsolated(raw);
  const pool = tenantScopedPool(raw);
  const facts = createWishlistStore(pool, actor);
  if (mode === 'enqueue') {
    console.log('Operational record:', await facts.write({ itemId: 'blue-jacket', name: 'Blue jacket' }));
    const jobs = new PgMemoryJobStore(pool);
    const accepted = await jobs.submit({ text: 'I usually prefer dark colors.', sourceId: 'wishlist-demo:turn-1',
      scope: { kind: 'user', userId: actor.userId } }, actor, 'wishlist-demo:preference-v1');
    console.log('Durably accepted:', accepted);
    console.log('This process can exit now. Run the worker, then start a new context session.');
  } else if (mode === 'context' || mode === 'temporary') {
    const openai = process.env.THEOMEM_EMBEDDER === 'openai';
    const { OpenAIEmbedder } = openai ? await import('@usetheo/memory/embedders/openai') : {};
    const { LocalTransformerEmbedder } = openai ? {} : await import('@usetheo/memory/embedders/local');
    const embedder = openai ? new OpenAIEmbedder() : new LocalTransformerEmbedder();
    const memory = await createLocalMemory({ vectorStore: new PgvectorStore(pool, { embeddingDim: openai ? 1536 : 384 }),
      embedder, llm: new OpenAILLM(), embeddingDim: openai ? 1536 : 384, entityBoost: false });
    if (mode === 'temporary') {
      const items = await withWorkspaceScope(actor.workspaceId, () => memory.withWorkspace(actor.workspaceId)
        .session('demo-dinner', actor.userId).remember('The dinner invitation specifies formal attire.', {
          infer: false, category: 'event-context', expiresAt: new Date(Date.now() + 60_000),
          evidence: { kind: 'observed', sourceId: 'invitation:demo-dinner', modality: 'text' },
        }));
      console.log('Temporary context:', items);
    } else {
    const session = new MemorySession({ memory: memory.withWorkspace(actor.workspaceId).user(actor.userId), facts });
    const context = await withWorkspaceScope(actor.workspaceId, () => session.loadContext({ itemId: 'blue-jacket' }, 'Clothing preferences for dinner'));
    console.log('New session:', context);
    console.log('Exact miss stays empty:', await session.lookupFacts({ itemId: 'missing-jacket' }));
    await session.close();
    console.log('Active temporary context:', await withWorkspaceScope(actor.workspaceId, () => memory.withWorkspace(actor.workspaceId).session('demo-dinner', actor.userId).getAll({ category: 'event-context' })));
    }
  } else {
    throw new Error('Use enqueue, context, or temporary.');
  }
} finally {
  await raw.end();
}
