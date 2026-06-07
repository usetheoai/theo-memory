/**
 * T3.1 RED tests — OidcAuthVerifier.
 *
 * Plan: `theo-memory-faang-auth-lifecycle` § T3.1 + ADR D1.
 *
 * Covers:
 *   - Happy path (active=true → verify returns true)
 *   - Inactive (active=false → verify returns false)
 *   - Network error / introspect rejection → fail-closed (false)
 *   - Cache TTL — second call within TTL hits cache (no re-introspect)
 *   - EC-4 — introspection HTTP timeout → fail-closed (false)
 *   - EC-5 — concurrent verify() for same token → introspection fires ONCE
 */
import { describe, expect, test, vi } from 'vitest';

import { OidcAuthVerifier, type IntrospectFn } from '../oidc-verifier.js';

const TOKEN = 'eyJhbGciOiJSUzI1NiJ9.someJwtPayload.signature';

describe('OidcAuthVerifier — happy + error paths', () => {
  test('1. verify returns true when introspection responds active=true', async () => {
    const introspect: IntrospectFn = vi.fn(() => Promise.resolve({ active: true }));
    const v = new OidcAuthVerifier({ introspect, cacheTtlSeconds: 0 });
    await expect(v.verify(TOKEN)).resolves.toBe(true);
    expect(introspect).toHaveBeenCalledTimes(1);
  });

  test('2. verify returns false when introspection responds active=false', async () => {
    const introspect: IntrospectFn = vi.fn(() => Promise.resolve({ active: false }));
    const v = new OidcAuthVerifier({ introspect, cacheTtlSeconds: 0 });
    await expect(v.verify(TOKEN)).resolves.toBe(false);
  });

  test('3. verify returns false when introspection throws (network error)', async () => {
    const introspect: IntrospectFn = vi.fn(() => Promise.reject(new Error('ECONNREFUSED')));
    const v = new OidcAuthVerifier({ introspect, cacheTtlSeconds: 0 });
    await expect(v.verify(TOKEN)).resolves.toBe(false);
  });

  test('4. verify returns false for empty token (no introspect call)', async () => {
    const introspect: IntrospectFn = vi.fn(() => Promise.resolve({ active: true }));
    const v = new OidcAuthVerifier({ introspect });
    await expect(v.verify('')).resolves.toBe(false);
    expect(introspect).not.toHaveBeenCalled();
  });
});

describe('OidcAuthVerifier — cache + EC-5 coalescing', () => {
  test('5. caches active result within TTL — second verify hits cache', async () => {
    const introspect: IntrospectFn = vi.fn(() => Promise.resolve({ active: true }));
    const v = new OidcAuthVerifier({ introspect, cacheTtlSeconds: 60 });
    await v.verify(TOKEN);
    await v.verify(TOKEN);
    expect(introspect).toHaveBeenCalledTimes(1);
  });

  test('6. cacheTtlSeconds=0 disables cache — every call re-introspects', async () => {
    const introspect: IntrospectFn = vi.fn(() => Promise.resolve({ active: true }));
    const v = new OidcAuthVerifier({ introspect, cacheTtlSeconds: 0 });
    await v.verify(TOKEN);
    await v.verify(TOKEN);
    await v.verify(TOKEN);
    expect(introspect).toHaveBeenCalledTimes(3);
  });

  test('7. EC-5 — concurrent verify() for same token shares ONE introspection', async () => {
    let resolveInner: ((v: { active: boolean }) => void) | undefined;
    const introspectImpl: IntrospectFn = () =>
      new Promise<{ active: boolean }>((r) => {
        resolveInner = r;
      });
    const introspect = vi.fn(introspectImpl) as IntrospectFn & ReturnType<typeof vi.fn>;
    const v = new OidcAuthVerifier({ introspect, cacheTtlSeconds: 0 });

    // Fire 10 concurrent verifies for the same token while introspection is hung.
    const promises = Array.from({ length: 10 }, () => v.verify(TOKEN));
    // Allow microtask queue to drain so all 10 hit the in-flight Map.
    await new Promise((r) => setImmediate(r));
    // Only ONE introspect call should have been made.
    expect(introspect).toHaveBeenCalledTimes(1);
    // Resolve the introspection — all 10 callers get the same answer.
    resolveInner?.({ active: true });
    const results = await Promise.all(promises);
    expect(results).toEqual(Array.from({ length: 10 }, () => true));
  });
});

describe('OidcAuthVerifier — EC-4 timeout', () => {
  test('8. verify returns false when introspection exceeds introspectionTimeoutMs', async () => {
    let abortedReason: Error | null = null;
    const introspect: IntrospectFn = (_token, signal) => {
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          const reason = signal.reason instanceof Error ? signal.reason : new Error('aborted');
          abortedReason = reason;
          reject(reason);
        });
        // Never resolve on its own — relies on the signal to abort.
      });
    };
    const v = new OidcAuthVerifier({ introspect, cacheTtlSeconds: 0, introspectionTimeoutMs: 50 });
    const start = Date.now();
    const result = await v.verify(TOKEN);
    const elapsed = Date.now() - start;
    expect(result).toBe(false);
    expect(elapsed).toBeLessThan(500); // bounded by 50ms timeout + scheduler slop
    expect(abortedReason).not.toBeNull(); // signal was fired
  });
});
