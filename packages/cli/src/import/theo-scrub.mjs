// theo-scrub.mjs — shared, fail-closed secret/PII scrub for the theo-memory
// Claude Code integration.
//
// SINGLE SOURCE OF TRUTH (M6-SEC-01): both the auto-remember hooks (Stop /
// PreCompact — the ONGOING write path) AND the one-shot migration tool import the
// same deny-list + scrub() from here. The hooks run on infer=false verbatim stores,
// so the CLIENT scrub is the only opportunity to keep a secret out of the store.
//
// Ordered deny-list: specific, high-precision patterns run BEFORE the generic
// high-entropy catch-all so a known key gets its precise `kind`. Every match is
// replaced with `[REDACTED:<kind>]`. Security-critical — blueprint ADR-4.
//
// Redaction bias (Rule 3 honesty): a false-positive redaction loses a little
// legitimate text; a false-negative leaks a live secret. When in doubt, redact.

/** @typedef {{ kind: string, re: RegExp, privateKey?: boolean }} SecretPattern */

/** @type {SecretPattern[]} */
export const SECRET_PATTERNS = [
  // Multi-line PEM block first — its body would otherwise be shredded by later rules.
  { kind: 'private_key', re: /-----BEGIN[A-Z ]*PRIVATE KEY-----[\s\S]*?-----END[A-Z ]*PRIVATE KEY-----/g, privateKey: true },
  // Connection strings BEFORE token rules so the whole scheme://user:pass@ prefix
  // (incl. an inline password shorter than the entropy floor) is caught as one unit.
  { kind: 'db_connection_string', re: /\b(?:postgres|postgresql|mysql|mariadb|redis|rediss|mongodb(?:\+srv)?|amqp|amqps):\/\/[^:@/\s]+:[^@/\s]+@[^\s"'<>]+/gi },
  { kind: 'openai_key', re: /sk-[A-Za-z0-9_-]{20,}/g },
  { kind: 'theo_key', re: /theo_live_[A-Za-z0-9_-]+/g },
  { kind: 'aws_key', re: /AKIA[0-9A-Z]{16}/g },
  { kind: 'github_token', re: /gh[pousr]_[A-Za-z0-9]{20,}/g },
  { kind: 'slack_token', re: /xox[baprs]-[A-Za-z0-9-]{10,}/g },
  { kind: 'google_api_key', re: /AIza[0-9A-Za-z_-]{35}/g },
  { kind: 'jwt', re: /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g },
  { kind: 'bearer_token', re: /Bearer\s+[A-Za-z0-9._-]{20,}/g },
  // env-style assignment whose KEY names a secret (SECRET/TOKEN/KEY/PASSWORD/APIKEY):
  // redact the VALUE. Keeps the key visible for context, redacts only the secret.
  { kind: 'secret_assignment', re: /\b([A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|PASSWD|API_?KEY|ACCESS_?KEY|PRIVATE_?KEY)[A-Z0-9_]*\s*[:=]\s*)(['"]?)[^\s'"]{6,}\2/gi, valueGroup: true },
  // Generic high-entropy catch-all LAST. Now allows -/_ /= so base64url / hyphenated
  // tokens are caught, not only pure alnum runs (M6-SEC-03).
  { kind: 'high_entropy', re: /[A-Za-z0-9+/=_-]{32,}/g },
];

/**
 * Redact every deny-list match in `text`. Returns the scrubbed text plus the audit
 * metadata the migration uses for its fail-closed SKIP decision.
 *
 * @param {string} text
 * @returns {{ clean: string, redactedChars: number, originalChars: number, kinds: string[], hadPrivateKey: boolean }}
 */
export function scrub(text) {
  const originalChars = text.length;
  let clean = text;
  let redactedChars = 0;
  const kinds = [];
  let hadPrivateKey = false;
  for (const { kind, re, privateKey, valueGroup } of SECRET_PATTERNS) {
    clean = clean.replace(re, (match, keyPrefix, quote) => {
      // A `secret_assignment` match keeps the KEY= prefix and redacts only the value.
      if (valueGroup && typeof keyPrefix === 'string') {
        const q = typeof quote === 'string' ? quote : '';
        redactedChars += match.length - keyPrefix.length;
        kinds.push(kind);
        return `${keyPrefix}${q}[REDACTED:${kind}]${q}`;
      }
      redactedChars += match.length;
      kinds.push(kind);
      if (privateKey) hadPrivateKey = true;
      return `[REDACTED:${kind}]`;
    });
  }
  return { clean, redactedChars, originalChars, kinds, hadPrivateKey };
}

/**
 * Convenience for the ongoing hook path: return ONLY the scrubbed string. A memory
 * write never needs the audit metadata — just the safe text.
 *
 * @param {string} text
 * @returns {string}
 */
export function scrubText(text) {
  return scrub(text).clean;
}
