import { createHash } from 'node:crypto';

import { InvalidScope } from './errors.js';
import type { Message } from './message.js';
import type { RememberOptions } from './options.js';

/** Validate before provider I/O; request identity includes all caller-controlled semantics. */
export function validateWriteContext(options?: RememberOptions, allowExpired = false): void {
  if (options?.expiresAt !== undefined &&
      (!(options.expiresAt instanceof Date) || !Number.isFinite(options.expiresAt.getTime()) || (!allowExpired && options.expiresAt.getTime() <= Date.now()))) {
    throw new InvalidScope('expiresAt must be a valid future date.');
  }
  if (options?.idempotencyKey !== undefined &&
      (typeof options.idempotencyKey !== 'string' || options.idempotencyKey.trim().length === 0 || options.idempotencyKey.length > 256)) {
    throw new InvalidScope('idempotencyKey must contain 1-256 characters.');
  }
}

function canonical(value:unknown):unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,canonical(item)]));
  return value;
}

export function writeRequestHash(messages: readonly Message[], options?: RememberOptions): string {
  return createHash('sha256').update(JSON.stringify(canonical({ messages, infer: options?.infer ?? true,
    evidence: options?.evidence, category: options?.category, attributedTo: options?.attributedTo,
    expiresAt: options?.expiresAt?.toISOString(), metadata: options?.metadata,
  }))).digest('hex');
}

export function attachWriteContext(payload: Record<string, string | number | boolean | null>,
  messages: readonly Message[], options?: RememberOptions): void {
  delete payload['expires_at'];
  delete payload['idempotency_key'];
  delete payload['request_hash'];
  if (options?.expiresAt !== undefined) payload['expires_at'] = options.expiresAt.toISOString();
  if (options?.idempotencyKey !== undefined) {
    payload['idempotency_key'] = options.idempotencyKey;
    payload['request_hash'] = writeRequestHash(messages, options);
  }
}
