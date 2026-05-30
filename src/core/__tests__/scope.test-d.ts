import { expectTypeOf, test } from 'vitest';

import type {
  AgentScope,
  Filters,
  Scope,
  SessionScope,
  UserScope,
} from '../scope.js';

test('UserScope is assignable to Scope', () => {
  expectTypeOf<UserScope>().toMatchTypeOf<Scope>();
});

test('SessionScope is assignable to Scope', () => {
  expectTypeOf<SessionScope>().toMatchTypeOf<Scope>();
});

test('AgentScope is assignable to Scope', () => {
  expectTypeOf<AgentScope>().toMatchTypeOf<Scope>();
});

test('UserScope.kind is the literal "user"', () => {
  expectTypeOf<UserScope['kind']>().toEqualTypeOf<'user'>();
});

test('SessionScope.kind is the literal "session"', () => {
  expectTypeOf<SessionScope['kind']>().toEqualTypeOf<'session'>();
});

test('AgentScope.kind is the literal "agent"', () => {
  expectTypeOf<AgentScope['kind']>().toEqualTypeOf<'agent'>();
});

test('Scope discriminator extracts each tier correctly', () => {
  type WhenUser = Extract<Scope, { kind: 'user' }>;
  type WhenSession = Extract<Scope, { kind: 'session' }>;
  type WhenAgent = Extract<Scope, { kind: 'agent' }>;
  expectTypeOf<WhenUser>().toEqualTypeOf<UserScope>();
  expectTypeOf<WhenSession>().toEqualTypeOf<SessionScope>();
  expectTypeOf<WhenAgent>().toEqualTypeOf<AgentScope>();
});

test('Scope.kind union covers the four tiers (v0.6 adds repo)', () => {
  expectTypeOf<Scope['kind']>().toEqualTypeOf<'user' | 'session' | 'agent' | 'repo'>();
});

test('UserScope has exactly kind + userId (no extras)', () => {
  expectTypeOf<UserScope>().toEqualTypeOf<{
    readonly kind: 'user';
    readonly userId: string;
  }>();
});

test('SessionScope carries sessionId + optional userId for cross-tier filtering', () => {
  expectTypeOf<SessionScope>().toMatchTypeOf<{
    readonly kind: 'session';
    readonly sessionId: string;
  }>();
  expectTypeOf<SessionScope['userId']>().toEqualTypeOf<string | undefined>();
});

test('AgentScope carries agentId + optional userId for cross-tier filtering', () => {
  expectTypeOf<AgentScope>().toMatchTypeOf<{
    readonly kind: 'agent';
    readonly agentId: string;
  }>();
  expectTypeOf<AgentScope['userId']>().toEqualTypeOf<string | undefined>();
});

test('Filters has all three snake_case keys', () => {
  expectTypeOf<Filters>().toHaveProperty('user_id');
  expectTypeOf<Filters>().toHaveProperty('agent_id');
  expectTypeOf<Filters>().toHaveProperty('session_id');
});

test('Filters fields are optional readonly strings', () => {
  expectTypeOf<Filters['user_id']>().toEqualTypeOf<string | undefined>();
  expectTypeOf<Filters['agent_id']>().toEqualTypeOf<string | undefined>();
  expectTypeOf<Filters['session_id']>().toEqualTypeOf<string | undefined>();
});
