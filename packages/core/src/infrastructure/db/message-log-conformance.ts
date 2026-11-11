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
  });
}
