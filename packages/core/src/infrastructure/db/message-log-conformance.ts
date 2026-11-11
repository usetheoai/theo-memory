/**
 * Shared MessageLog conformance suite. Every adapter (in-memory, Postgres) runs the same
 * behavioral contract, so the two runtimes cannot drift.
 */
import { describe, expect, test, beforeEach } from 'vitest';

import type { MessageLog } from '../../domain/dip/message-log.js';
import type { Filters } from '../../domain/scope.js';

export interface MessageLogConformanceContext {
  readonly log: MessageLog;
  /** Create a memory row in this scope (Postgres needs a real one for the foreign key) and return its id. */
  readonly createMemory: (filters: Filters) => Promise<string>;
  /** Run `fn` with the workspace context the adapter's writes need. */
  readonly inScope: <T>(filters: Filters, fn: () => Promise<T>) => Promise<T>;
  readonly reset: () => Promise<void>;
  /** Dimension of the message embedding column the adapter accepts. */
  readonly embeddingDim: number;
}

export function runMessageLogConformance(name: string, setup: () => Promise<MessageLogConformanceContext>): void {
  describe(`MessageLog conformance: ${name}`, () => {
    let ctx: MessageLogConformanceContext;
    const userA: Filters = { workspace_id: 'default', user_id: 'conformance-user-a' };
    const userB: Filters = { workspace_id: 'default', user_id: 'conformance-user-b' };
    const sessionA: Filters = { workspace_id: 'default', user_id: 'conformance-user-a', session_id: 'conformance-session' };

    beforeEach(async () => {
      ctx = await setup();
      await ctx.reset();
    });

    test('append returns one id per message and recent returns them oldest first', async () => {
      const observedAt = new Date('2023-05-08T13:56:00Z');
      const ids = await ctx.inScope(userA, () =>
        ctx.log.append(userA, [{ role: 'user', content: 'I moved to Lisbon' }, { role: 'assistant', content: 'Nice city' }], observedAt));
      expect(ids).toHaveLength(2);
      expect(new Set(ids).size).toBe(2);
      const recent = await ctx.inScope(userA, () => ctx.log.recent(userA, 10));
      expect(recent.map((m) => [m.id, m.role, m.content])).toEqual([
        [ids[0], 'user', 'I moved to Lisbon'],
        [ids[1], 'assistant', 'Nice city'],
      ]);
      expect(recent[0]?.observedAt?.toISOString()).toBe(observedAt.toISOString());
      expect(recent[0]?.loggedAt).toBeInstanceOf(Date);
    });

    test('a message logged without an observation time reports observedAt as null', async () => {
      await ctx.inScope(userA, () => ctx.log.append(userA, [{ role: 'user', content: 'hello' }]));
      const [only] = await ctx.inScope(userA, () => ctx.log.recent(userA, 1));
      expect(only?.observedAt).toBeNull();
    });

    test('recent returns only the last `limit` messages, still oldest first', async () => {
      for (const content of ['one', 'two', 'three', 'four']) {
        await ctx.inScope(userA, () => ctx.log.append(userA, [{ role: 'user', content }]));
      }
      const recent = await ctx.inScope(userA, () => ctx.log.recent(userA, 2));
      expect(recent.map((m) => m.content)).toEqual(['three', 'four']);
      expect(await ctx.inScope(userA, () => ctx.log.recent(userA, 0))).toEqual([]);
    });

    test('recent is confined to exactly the requested scope', async () => {
      await ctx.inScope(userA, () => ctx.log.append(userA, [{ role: 'user', content: 'user A' }]));
      await ctx.inScope(sessionA, () => ctx.log.append(sessionA, [{ role: 'user', content: 'session of A' }]));
      expect((await ctx.inScope(userB, () => ctx.log.recent(userB, 10))).map((m) => m.content)).toEqual([]);
      expect((await ctx.inScope(userA, () => ctx.log.recent(userA, 10))).map((m) => m.content)).toEqual(['user A']);
      expect((await ctx.inScope(sessionA, () => ctx.log.recent(sessionA, 10))).map((m) => m.content)).toEqual(['session of A']);
    });

    test('append of no messages logs nothing', async () => {
      expect(await ctx.inScope(userA, () => ctx.log.append(userA, []))).toEqual([]);
      expect(await ctx.inScope(userA, () => ctx.log.recent(userA, 10))).toEqual([]);
    });

    test('sourcesOf returns the messages linked to a memory, and linking twice is harmless', async () => {
      const memoryId = await ctx.inScope(userA, () => ctx.createMemory(userA));
      const ids = await ctx.inScope(userA, () =>
        ctx.log.append(userA, [{ role: 'user', content: 'first' }, { role: 'user', content: 'second' }]));
      await ctx.inScope(userA, () => ctx.log.linkSources(userA, [memoryId], ids));
      await ctx.inScope(userA, () => ctx.log.linkSources(userA, [memoryId], ids));
      const sources = await ctx.inScope(userA, () => ctx.log.sourcesOf(userA, memoryId));
      expect(sources.map((m) => m.content)).toEqual(['first', 'second']);
    });

    test('sourcesOf from another scope sees nothing', async () => {
      const memoryId = await ctx.inScope(userA, () => ctx.createMemory(userA));
      const ids = await ctx.inScope(userA, () => ctx.log.append(userA, [{ role: 'user', content: 'private' }]));
      await ctx.inScope(userA, () => ctx.log.linkSources(userA, [memoryId], ids));
      expect(await ctx.inScope(userB, () => ctx.log.sourcesOf(userB, memoryId))).toEqual([]);
    });

    test('sourcesFor returns the sources of several memories in one call, keyed by memory id', async () => {
      const first = await ctx.inScope(userA, () => ctx.createMemory(userA));
      const second = await ctx.inScope(userA, () => ctx.createMemory(userA));
      const unsourced = await ctx.inScope(userA, () => ctx.createMemory(userA));
      const [m1, m2] = await ctx.inScope(userA, () =>
        ctx.log.append(userA, [{ role: 'user', content: 'one' }, { role: 'user', content: 'two' }]));
      await ctx.inScope(userA, () => ctx.log.linkSources(userA, [first], [m1!, m2!]));
      await ctx.inScope(userA, () => ctx.log.linkSources(userA, [second], [m2!]));
      const byMemory = await ctx.inScope(userA, () => ctx.log.sourcesFor(userA, [first, second, unsourced]));
      expect(byMemory.get(first)?.map((m) => m.content)).toEqual(['one', 'two']);
      expect(byMemory.get(second)?.map((m) => m.content)).toEqual(['two']);
      expect(byMemory.get(unsourced) ?? []).toEqual([]);
      expect((await ctx.inScope(userB, () => ctx.log.sourcesFor(userB, [first]))).get(first) ?? []).toEqual([]);
      expect((await ctx.inScope(userA, () => ctx.log.sourcesFor(userA, []))).size).toBe(0);
    });

    test('eraseSourcesOf removes the linked messages from the log and leaves the rest', async () => {
      const memoryId = await ctx.inScope(userA, () => ctx.createMemory(userA));
      const [linked] = await ctx.inScope(userA, () => ctx.log.append(userA, [{ role: 'user', content: 'forget me' }]));
      await ctx.inScope(userA, () => ctx.log.append(userA, [{ role: 'user', content: 'keep me' }]));
      await ctx.inScope(userA, () => ctx.log.linkSources(userA, [memoryId], [linked!]));
      expect(await ctx.inScope(userA, () => ctx.log.eraseSourcesOf(userA, memoryId))).toBe(1);
      expect((await ctx.inScope(userA, () => ctx.log.recent(userA, 10))).map((m) => m.content)).toEqual(['keep me']);
      expect(await ctx.inScope(userA, () => ctx.log.sourcesOf(userA, memoryId))).toEqual([]);
    });

    test('an erased message disappears from every memory that cited it', async () => {
      const forgotten = await ctx.inScope(userA, () => ctx.createMemory(userA));
      const sibling = await ctx.inScope(userA, () => ctx.createMemory(userA));
      const ids = await ctx.inScope(userA, () => ctx.log.append(userA, [{ role: 'user', content: 'shared turn' }]));
      await ctx.inScope(userA, () => ctx.log.linkSources(userA, [forgotten, sibling], ids));
      await ctx.inScope(userA, () => ctx.log.eraseSourcesOf(userA, forgotten));
      expect(await ctx.inScope(userA, () => ctx.log.sourcesOf(userA, sibling))).toEqual([]);
    });

    test('eraseSourcesOf for another scope erases nothing', async () => {
      const memoryId = await ctx.inScope(userA, () => ctx.createMemory(userA));
      const ids = await ctx.inScope(userA, () => ctx.log.append(userA, [{ role: 'user', content: 'mine' }]));
      await ctx.inScope(userA, () => ctx.log.linkSources(userA, [memoryId], ids));
      expect(await ctx.inScope(userB, () => ctx.log.eraseSourcesOf(userB, memoryId))).toBe(0);
      expect(await ctx.inScope(userA, () => ctx.log.sourcesOf(userA, memoryId))).toHaveLength(1);
    });

    test('eraseScope erases every message of the scope, with or without a memory, and counts them', async () => {
      const memoryId = await ctx.inScope(userA, () => ctx.createMemory(userA));
      const [linked] = await ctx.inScope(userA, () => ctx.log.append(userA, [{ role: 'user', content: 'produced a fact' }]));
      await ctx.inScope(userA, () => ctx.log.append(userA, [{ role: 'user', content: 'produced nothing' }]));
      await ctx.inScope(userA, () => ctx.log.linkSources(userA, [memoryId], [linked!]));
      expect(await ctx.inScope(userA, () => ctx.log.eraseScope({ ...userA, scopeHierarchy: 'global' }))).toBe(2);
      expect(await ctx.inScope(userA, () => ctx.log.recent(userA, 10))).toEqual([]);
      expect(await ctx.inScope(userA, () => ctx.log.sourcesOf(userA, memoryId))).toEqual([]);
    });

    test("eraseScope of a user's global scope keeps that user's sessions and every other user", async () => {
      await ctx.inScope(userA, () => ctx.log.append(userA, [{ role: 'user', content: 'global of A' }]));
      await ctx.inScope(sessionA, () => ctx.log.append(sessionA, [{ role: 'user', content: 'session of A' }]));
      await ctx.inScope(userB, () => ctx.log.append(userB, [{ role: 'user', content: 'global of B' }]));
      await ctx.inScope(userA, () => ctx.log.eraseScope({ ...userA, scopeHierarchy: 'global' }));
      expect((await ctx.inScope(sessionA, () => ctx.log.recent(sessionA, 10))).map((m) => m.content)).toEqual(['session of A']);
      expect((await ctx.inScope(userB, () => ctx.log.recent(userB, 10))).map((m) => m.content)).toEqual(['global of B']);
    });

    test("eraseScope of a user's session keeps the user's global messages", async () => {
      await ctx.inScope(userA, () => ctx.log.append(userA, [{ role: 'user', content: 'global of A' }]));
      await ctx.inScope(sessionA, () => ctx.log.append(sessionA, [{ role: 'user', content: 'session of A' }]));
      expect(await ctx.inScope(sessionA, () => ctx.log.eraseScope(sessionA))).toBe(1);
      expect((await ctx.inScope(userA, () => ctx.log.recent(userA, 10))).map((m) => m.content)).toEqual(['global of A']);
      expect(await ctx.inScope(sessionA, () => ctx.log.recent(sessionA, 10))).toEqual([]);
    });

    test('eraseScope without a user erases that session for every user', async () => {
      await ctx.inScope(sessionA, () => ctx.log.append(sessionA, [{ role: 'user', content: 'session of A' }]));
      const sessionB: Filters = { ...userB, session_id: 'conformance-session' };
      await ctx.inScope(sessionB, () => ctx.log.append(sessionB, [{ role: 'user', content: 'session of B' }]));
      const anyUser: Filters = { workspace_id: 'default', session_id: 'conformance-session' };
      expect(await ctx.inScope(anyUser, () => ctx.log.eraseScope(anyUser))).toBe(2);
    });

    test('search ranks the scope messages that share a query term and leaves out the rest', async () => {
      await ctx.inScope(userA, () => ctx.log.append(userA, [
        { role: 'user', content: 'I adopted a rabbit named Pepper' },
        { role: 'user', content: 'The weather was lovely today' },
        { role: 'user', content: 'Pepper the rabbit chewed the rabbit cage' },
      ]));
      const found = await ctx.inScope(userA, () => ctx.log.search(userA, 'rabbit Pepper', { limit: 5 }));
      expect(found.map((m) => m.content)).toEqual(['Pepper the rabbit chewed the rabbit cage', 'I adopted a rabbit named Pepper']);
      expect(found.every((m) => m.score > 0)).toBe(true);
      expect(await ctx.inScope(userA, () => ctx.log.search(userA, 'rabbit', { limit: 1 }))).toHaveLength(1);
    });

    test('search finds nothing for a query without a matching term', async () => {
      await ctx.inScope(userA, () => ctx.log.append(userA, [{ role: 'user', content: 'I adopted a rabbit' }]));
      expect(await ctx.inScope(userA, () => ctx.log.search(userA, 'volcano', { limit: 5 }))).toEqual([]);
    });

    test('search never returns another user', async () => {
      await ctx.inScope(userB, () => ctx.log.append(userB, [{ role: 'user', content: 'my rabbit is named Pepper' }]));
      expect(await ctx.inScope(userA, () => ctx.log.search(userA, 'rabbit', { limit: 5 }))).toEqual([]);
    });

    test("a user's global search does not see that user's sessions", async () => {
      await ctx.inScope(sessionA, () => ctx.log.append(sessionA, [{ role: 'user', content: 'rabbit in a session' }]));
      expect(await ctx.inScope(userA, () => ctx.log.search({ ...userA, scopeHierarchy: 'global' }, 'rabbit', { limit: 5 }))).toEqual([]);
    });

    test("a user-bound session search sees its own and the user's global messages, not other sessions", async () => {
      const otherSession: Filters = { ...userA, session_id: 'conformance-other-session' };
      await ctx.inScope(userA, () => ctx.log.append(userA, [{ role: 'user', content: 'global rabbit' }]));
      await ctx.inScope(sessionA, () => ctx.log.append(sessionA, [{ role: 'user', content: 'session rabbit' }]));
      await ctx.inScope(otherSession, () => ctx.log.append(otherSession, [{ role: 'user', content: 'other session rabbit' }]));
      const visible: Filters = { ...sessionA, scopeHierarchy: { session: 'conformance-session' } };
      const found = await ctx.inScope(sessionA, () => ctx.log.search(visible, 'rabbit', { limit: 5 }));
      expect(found.map((m) => m.content).sort()).toEqual(['global rabbit', 'session rabbit']);
    });

    test('search with asOf leaves out messages observed after that instant', async () => {
      await ctx.inScope(userA, () => ctx.log.append(userA, [{ role: 'user', content: 'old rabbit' }], new Date('2023-01-01T00:00:00Z')));
      await ctx.inScope(userA, () => ctx.log.append(userA, [{ role: 'user', content: 'new rabbit' }], new Date('2024-01-01T00:00:00Z')));
      const found = await ctx.inScope(userA, () => ctx.log.search({ ...userA, asOf: new Date('2023-06-01T00:00:00Z') }, 'rabbit', { limit: 5 }));
      expect(found.map((m) => m.content)).toEqual(['old rabbit']);
    });

    /** Unit vector along axis `i`: orthogonal to every other axis, so similarity has no ties. */
    function axis(i: number): number[] {
      const v = new Array<number>(ctx.embeddingDim).fill(0);
      v[i] = 1;
      return v;
    }

    test('with a query vector, search finds a message by meaning when no word matches', async () => {
      await ctx.inScope(userA, () => ctx.log.append(userA, [
        { role: 'user', content: 'my knee hurts after cycling' },
        { role: 'user', content: 'the weather was lovely' },
      ], undefined, [axis(0), axis(1)]));

      const found = await ctx.inScope(userA, () => ctx.log.search(userA, 'joint pain', { limit: 1, queryVector: axis(0) }));

      expect(found.map((m) => m.content)).toEqual(['my knee hurts after cycling']);
    });

    test('with a query vector, a message logged without an embedding is still found by its words', async () => {
      await ctx.inScope(userA, () => ctx.log.append(userA, [{ role: 'user', content: 'rabbit named Pepper' }]));
      await ctx.inScope(userA, () => ctx.log.append(userA, [{ role: 'user', content: 'the weather was lovely' }], undefined, [axis(1)]));

      const found = await ctx.inScope(userA, () => ctx.log.search(userA, 'rabbit', { limit: 5, queryVector: axis(1) }));

      expect(found.map((m) => m.content).sort()).toEqual(['rabbit named Pepper', 'the weather was lovely']);
    });

    test("with a query vector, search never returns another user's message", async () => {
      await ctx.inScope(userB, () => ctx.log.append(userB, [{ role: 'user', content: 'knee pain' }], undefined, [axis(0)]));

      expect(await ctx.inScope(userA, () => ctx.log.search(userA, 'knee', { limit: 5, queryVector: axis(0) }))).toEqual([]);
    });

    test('with a query vector, the best match by meaning is not pushed out by weaker word matches', async () => {
      const half = axis(0).map((x, i) => (i === 1 ? 1 : x));
      await ctx.inScope(userA, () => ctx.log.append(userA, [
        { role: 'user', content: 'raise the saddle a little' },
        { role: 'user', content: 'a lower seat strains the joint' },
        { role: 'user', content: 'my bike pain story one' },
        { role: 'user', content: 'my bike pain story two' },
        { role: 'user', content: 'my bike pain story three' },
      ], undefined, [axis(0), half, axis(2), axis(3), axis(4)]));

      const found = await ctx.inScope(userA, () => ctx.log.search(userA, 'bike pain', { limit: 2, queryVector: axis(0) }));

      expect(found.map((m) => m.content)).toContain('raise the saddle a little');
    });

    test('with a query vector, a fused tie goes to the message closer in meaning, whatever the ids', async () => {
      // With limit 1 each ranking contributes one message: the word match tops BM25 and the
      // meaning match tops cosine, so both score 1/(k+1). Several scopes and both logging orders,
      // so a tie-break on ids or on logging order could not pass by luck.
      const partlyClose = axis(1).map((x, i) => (i === 1 ? 0.6 : i === 2 ? 0.8 : x));
      for (let i = 0; i < 6; i += 1) {
        const scope: Filters = { workspace_id: 'default', user_id: `meaning-tie-${String(i)}` };
        const wordMatch = { message: { role: 'user' as const, content: 'my bike story' }, vector: partlyClose };
        const meaningMatch = { message: { role: 'user' as const, content: 'raise the saddle a little' }, vector: axis(1) };
        for (const entry of i % 2 === 0 ? [wordMatch, meaningMatch] : [meaningMatch, wordMatch]) {
          await ctx.inScope(scope, () => ctx.log.append(scope, [entry.message], undefined, [entry.vector]));
        }

        const found = await ctx.inScope(scope, () => ctx.log.search(scope, 'bike', { limit: 1, queryVector: axis(1) }));

        expect(found.map((m) => m.content)).toEqual(['raise the saddle a little']);
      }
    });

    test('messages equal in words and in meaning come back in logging order, with or without a query vector', async () => {
      for (let i = 0; i < 6; i += 1) {
        const scope: Filters = { workspace_id: 'default', user_id: `logging-order-${String(i)}` };
        const [first, second] = i % 2 === 0 ? ['bike red', 'bike tan'] : ['bike tan', 'bike red'];
        await ctx.inScope(scope, () => ctx.log.append(scope, [{ role: 'user', content: first }], undefined, [axis(1)]));
        await ctx.inScope(scope, () => ctx.log.append(scope, [{ role: 'user', content: second }], undefined, [axis(1)]));

        const byMeaning = await ctx.inScope(scope, () => ctx.log.search(scope, 'bike', { limit: 2, queryVector: axis(1) }));
        const byWords = await ctx.inScope(scope, () => ctx.log.search(scope, 'bike', { limit: 2 }));

        expect(byMeaning.map((m) => m.content)).toEqual([first, second]);
        expect(byWords.map((m) => m.content)).toEqual([first, second]);
      }
    });

    test('without surroundingTurns, a result carries no surrounding turns', async () => {
      await ctx.inScope(userA, () => ctx.log.append(userA, [{ role: 'user', content: 'a' }, { role: 'user', content: 'the rabbit' }]));
      const [found] = await ctx.inScope(userA, () => ctx.log.search(userA, 'rabbit', { limit: 1 }));
      expect(found?.surrounding).toBeUndefined();
    });

    test('surroundingTurns returns the turns logged just before and after each result, in order', async () => {
      await ctx.inScope(userA, () => ctx.log.append(userA, [
        { role: 'user', content: 'one' },
        { role: 'assistant', content: 'two' },
        { role: 'user', content: 'my rabbit is ill' },
      ]));
      await ctx.inScope(userA, () => ctx.log.append(userA, [
        { role: 'assistant', content: 'see a vet' },
        { role: 'user', content: 'five' },
      ]));
      const one = await ctx.inScope(userA, () => ctx.log.search(userA, 'rabbit', { limit: 1, surroundingTurns: 1 }));
      expect(one[0]?.surrounding?.before.map((m) => m.content)).toEqual(['two']);
      expect(one[0]?.surrounding?.after.map((m) => m.content)).toEqual(['see a vet']);
      const two = await ctx.inScope(userA, () => ctx.log.search(userA, 'rabbit', { limit: 1, surroundingTurns: 2 }));
      expect(two[0]?.surrounding?.before.map((m) => m.content)).toEqual(['one', 'two']);
      expect(two[0]?.surrounding?.after.map((m) => m.content)).toEqual(['see a vet', 'five']);
    });

    test('surroundingTurns stops at the edges of the log', async () => {
      await ctx.inScope(userA, () => ctx.log.append(userA, [{ role: 'user', content: 'my rabbit' }]));
      const [found] = await ctx.inScope(userA, () => ctx.log.search(userA, 'rabbit', { limit: 1, surroundingTurns: 1 }));
      expect(found?.surrounding).toEqual({ before: [], after: [] });
    });

    test('surrounding turns come only from the stream of the result, never another session or user', async () => {
      const otherSession: Filters = { ...userA, session_id: 'conformance-other-session' };
      await ctx.inScope(sessionA, () => ctx.log.append(sessionA, [{ role: 'user', content: 'session before' }]));
      await ctx.inScope(otherSession, () => ctx.log.append(otherSession, [{ role: 'user', content: 'other session' }]));
      await ctx.inScope(userB, () => ctx.log.append(userB, [{ role: 'user', content: 'other user' }]));
      await ctx.inScope(userA, () => ctx.log.append(userA, [{ role: 'user', content: 'global' }]));
      await ctx.inScope(sessionA, () => ctx.log.append(sessionA, [{ role: 'user', content: 'session rabbit' }]));
      await ctx.inScope(otherSession, () => ctx.log.append(otherSession, [{ role: 'user', content: 'other session later' }]));
      const visible: Filters = { ...sessionA, scopeHierarchy: { session: 'conformance-session' } };
      const [found] = await ctx.inScope(sessionA, () => ctx.log.search(visible, 'rabbit', { limit: 1, surroundingTurns: 1 }));
      expect(found?.content).toBe('session rabbit');
      expect(found?.surrounding?.before.map((m) => m.content)).toEqual(['session before']);
      expect(found?.surrounding?.after).toEqual([]);
    });

    test('surrounding turns respect asOf', async () => {
      await ctx.inScope(userA, () => ctx.log.append(userA, [{ role: 'user', content: 'old rabbit' }], new Date('2023-01-01T00:00:00Z')));
      await ctx.inScope(userA, () => ctx.log.append(userA, [{ role: 'assistant', content: 'later reply' }], new Date('2024-01-01T00:00:00Z')));
      const [found] = await ctx.inScope(userA, () =>
        ctx.log.search({ ...userA, asOf: new Date('2023-06-01T00:00:00Z') }, 'rabbit', { limit: 1, surroundingTurns: 1 }));
      expect(found?.surrounding?.after).toEqual([]);
    });

    test('append rejects embeddings that do not line up with the messages', async () => {
      await expect(ctx.inScope(userA, () => ctx.log.append(userA, [{ role: 'user', content: 'a' }, { role: 'user', content: 'b' }], undefined, [axis(0)])))
        .rejects.toThrow(RangeError);
    });
  });
}
