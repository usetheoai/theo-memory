/**
 * `themory keys` subcommand orchestrator.
 *
 * Plan: `theo-memory-faang-auth-lifecycle` § T2.3.
 *
 * Wraps the admin REST endpoints (T2.1) with a thin CLI surface:
 *   - `themory keys create --name X --scope memory:read [--scope memory:write] [--expires ISO]`
 *   - `themory keys list`
 *   - `themory keys rotate <apk-id> [--grace-hours N]`
 *   - `themory keys revoke <apk-id>`
 *
 * All actions hit a base URL (default `http://localhost:3000` per the
 * `themory server` default port) using global `fetch` + Bearer auth from
 * `THEMEMORY_API_KEY` env (admin scope required — caller's responsibility
 * to point this at an admin token OR the bootstrap token).
 *
 * `create` prints the raw secret with a one-shot warning ("save now —
 * won't show again") — matches the dashboard EC-13 show-once UX in CLI form.
 *
 */

export interface RunKeysContext {
  readonly baseUrl: string;
  readonly bearerToken: string;
  /** Injection seam for tests; defaults to global fetch. */
  readonly fetchImpl?: typeof fetch;
  /** Injection seam for tests; defaults to process.stdout.write. */
  readonly writeStdout?: (s: string) => void;
  /** Injection seam for tests; defaults to process.stderr.write. */
  readonly writeStderr?: (s: string) => void;
}

export interface CreateKeyArgs {
  readonly name: string;
  readonly scopes: readonly string[];
  readonly expiresAt?: string;
}

function buildContext(ctx: RunKeysContext): {
  doFetch: typeof fetch;
  stdout: (s: string) => void;
  stderr: (s: string) => void;
  authHeader: { Authorization: string };
} {
  return {
    doFetch: ctx.fetchImpl ?? fetch,
    stdout: ctx.writeStdout ?? ((s) => process.stdout.write(s)),
    stderr: ctx.writeStderr ?? ((s) => process.stderr.write(s)),
    authHeader: { Authorization: `Bearer ${ctx.bearerToken}` },
  };
}

export async function runKeysCreate(ctx: RunKeysContext, args: CreateKeyArgs): Promise<number> {
  const { doFetch, stdout, stderr, authHeader } = buildContext(ctx);
  const body = JSON.stringify({
    name: args.name,
    scopes: args.scopes,
    ...(args.expiresAt !== undefined ? { expires_at: args.expiresAt } : {}),
  });
  let res: Response;
  try {
    res = await doFetch(`${ctx.baseUrl}/v1/admin/keys`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeader },
      body,
    });
  } catch (err) {
    stderr(`themory keys create: network error: ${String(err)}\n`);
    return 2;
  }
  const text = await res.text();
  if (res.status !== 200) {
    stderr(`themory keys create: HTTP ${res.status}\n${text}\n`);
    return 1;
  }
  const parsed = JSON.parse(text) as {
    id: string;
    name: string;
    key_prefix: string;
    scopes: string[];
    secret: string;
  };
  // Show-once UX: print secret + warning loudly.
  stdout(`\n  API key created: ${parsed.id} (${parsed.name})\n`);
  stdout(`  Scopes: ${parsed.scopes.join(', ')}\n\n`);
  stdout(`  ${parsed.secret}\n\n`);
  stdout(`  WARNING: save this secret now — it will NEVER be shown again.\n`);
  stdout(`           the dashboard only stores its prefix (${parsed.key_prefix}...)\n\n`);
  return 0;
}

export async function runKeysList(ctx: RunKeysContext): Promise<number> {
  const { doFetch, stdout, stderr, authHeader } = buildContext(ctx);
  let res: Response;
  try {
    res = await doFetch(`${ctx.baseUrl}/v1/admin/keys/list`, {
      method: 'GET',
      headers: authHeader,
    });
  } catch (err) {
    stderr(`themory keys list: network error: ${String(err)}\n`);
    return 2;
  }
  if (res.status !== 200) {
    stderr(`themory keys list: HTTP ${res.status}\n${await res.text()}\n`);
    return 1;
  }
  const { keys } = (await res.json()) as { keys: { id: string; name: string; key_prefix: string; scopes: string[]; created_at: string; last_used_at: string | null }[] };
  if (keys.length === 0) {
    stdout('No API keys.\n');
    return 0;
  }
  for (const k of keys) {
    stdout(`${k.id}  ${k.key_prefix}...  ${k.name}  [${k.scopes.join(',')}]  created=${k.created_at}  last_used=${k.last_used_at ?? 'never'}\n`);
  }
  return 0;
}

export async function runKeysRevoke(ctx: RunKeysContext, id: string): Promise<number> {
  const { doFetch, stdout, stderr, authHeader } = buildContext(ctx);
  let res: Response;
  try {
    res = await doFetch(`${ctx.baseUrl}/v1/admin/keys/${id}`, {
      method: 'DELETE',
      headers: authHeader,
    });
  } catch (err) {
    stderr(`themory keys revoke: network error: ${String(err)}\n`);
    return 2;
  }
  if (res.status === 204) {
    stdout(`Revoked ${id}\n`);
    return 0;
  }
  stderr(`themory keys revoke: HTTP ${res.status}\n${await res.text()}\n`);
  return 1;
}

export async function runKeysRotate(ctx: RunKeysContext, id: string, graceHours?: number): Promise<number> {
  const { doFetch, stdout, stderr, authHeader } = buildContext(ctx);
  const body = graceHours !== undefined ? JSON.stringify({ grace_window_hours: graceHours }) : '';
  let res: Response;
  try {
    res = await doFetch(`${ctx.baseUrl}/v1/admin/keys/${id}/rotate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeader },
      body,
    });
  } catch (err) {
    stderr(`themory keys rotate: network error: ${String(err)}\n`);
    return 2;
  }
  if (res.status !== 200) {
    stderr(`themory keys rotate: HTTP ${res.status}\n${await res.text()}\n`);
    return 1;
  }
  const parsed = (await res.json()) as {
    id: string;
    secret: string;
    old_id: string;
    grace_window_hours: number;
  };
  stdout(`\n  Rotated ${parsed.old_id} -> ${parsed.id}\n`);
  stdout(`  Grace window: ${parsed.grace_window_hours}h (old key still works until expiry)\n\n`);
  stdout(`  ${parsed.secret}\n\n`);
  stdout(`  WARNING: save this new secret now — it will NEVER be shown again.\n\n`);
  return 0;
}
