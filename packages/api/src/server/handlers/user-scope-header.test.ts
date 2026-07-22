/**
 * The REST surface must resolve the user tier the SAME way the MCP surface does —
 * from the auth-trusted `X-Theo-User-Id` the edge injects — so a caller that presents
 * no body tier (the Claude Code kit hooks) still lands under the credential's user,
 * unifying REST-written and MCP-written memory in one space the dashboard reads.
 *
 * Before this, REST took the tier ONLY from the body, so hook writes went to a
 * project-name tier invisible to the dashboard while MCP writes went to the subject.
 */
import { describe, expect, it } from 'vitest';
import { applyHeaderUserScope } from './_body-parsing.js';

/** Minimal Hono-Context stand-in exposing just req.header(name). */
function ctxWithHeader(headers: Record<string, string>): {
  req: { header: (name: string) => string | undefined };
} {
  const lower = Object.fromEntries(
    Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]),
  );
  return { req: { header: (name: string) => lower[name.toLowerCase()] } };
}

describe('applyHeaderUserScope', () => {
  it('fills userId from X-Theo-User-Id when the body carries no tier', () => {
    const ctx = ctxWithHeader({ 'X-Theo-User-Id': 'de110292-bcba-498a-94bd-631a755ca5e9' });
    const out = applyHeaderUserScope(ctx as never, { text: 'hi' });
    expect(out).toEqual({ text: 'hi', userId: 'de110292-bcba-498a-94bd-631a755ca5e9' });
  });

  it('leaves an explicit body tier untouched (body wins over the header)', () => {
    // A caller that names its own tier is honored — the header is only a fallback.
    const ctx = ctxWithHeader({ 'X-Theo-User-Id': 'from-header' });
    const out = applyHeaderUserScope(ctx as never, { text: 'hi', sessionId: 's1' });
    expect(out).toEqual({ text: 'hi', sessionId: 's1' });
  });

  it('is a no-op when neither header nor body tier is present', () => {
    // No identity anywhere → unchanged, so the schema still rejects it (fail-closed).
    const ctx = ctxWithHeader({});
    const out = applyHeaderUserScope(ctx as never, { text: 'hi' });
    expect(out).toEqual({ text: 'hi' });
  });

  it('ignores an empty or whitespace header value', () => {
    const ctx = ctxWithHeader({ 'X-Theo-User-Id': '   ' });
    const out = applyHeaderUserScope(ctx as never, { text: 'hi' });
    expect(out).toEqual({ text: 'hi' });
  });

  it('does not mutate the input body object', () => {
    const ctx = ctxWithHeader({ 'X-Theo-User-Id': 'u1' });
    const body = { text: 'hi' };
    applyHeaderUserScope(ctx as never, body);
    expect(body).toEqual({ text: 'hi' });
  });
});
