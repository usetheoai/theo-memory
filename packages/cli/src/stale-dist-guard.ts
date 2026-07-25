/**
 * Stale-dist guard (M20 / #118).
 *
 * When `themory server` runs from a compiled `dist/` in a DEV checkout (host-run), an out-of-date
 * `dist/` silently serves pre-build source — e.g. #118's pre-M13 entity code writing PROPER-cased
 * rows. This guard fails FAST with a typed error telling the operator to rebuild, instead of
 * serving stale code with no signal.
 *
 * No-op when `src/` is absent (a published package / distroless image has no source to compare
 * against — ADR D2), and fail-open on any I/O error in the guard itself: the guard must never take
 * down a legitimate boot because it could not stat a file.
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Thrown when the running `dist/` is older than `src/` — the operator must rebuild. */
export class StaleDistError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StaleDistError';
    // Restore the prototype chain (transpilation target < ES2015 loses it).
    Object.setPrototypeOf(this, StaleDistError.prototype);
  }
}

/** Newest `.ts` mtime (ms) under `dir`, recursively. `null` if the tree can't be read. */
function newestTsMtime(dir: string): number | null {
  let newest = 0;
  const walk = (d: string): void => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      const full = join(d, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith('.ts')) {
        const m = statSync(full).mtimeMs;
        if (m > newest) newest = m;
      }
    }
  };
  try {
    walk(dir);
    return newest;
  } catch {
    return null; // fail-open: an unreadable src tree does not block the boot
  }
}

/**
 * Throws {@link StaleDistError} when the compiled `distFile` is OLDER than the newest `.ts` under
 * `srcRoot`. No-op when `srcRoot` is null / missing (published package) or when either mtime can't
 * be read (fail-open). Pure and injectable so tests drive it with temp dirs.
 */
export function checkStaleDist(distFile: string, srcRoot: string | null): void {
  if (srcRoot === null || !existsSync(srcRoot) || !existsSync(distFile)) {
    return;
  }
  let distMtime: number;
  try {
    distMtime = statSync(distFile).mtimeMs;
  } catch {
    return; // fail-open
  }
  const newestSrc = newestTsMtime(srcRoot);
  if (newestSrc === null || newestSrc <= distMtime) {
    return;
  }
  throw new StaleDistError(
    `themory: the running build (dist) is older than the source (src). It would serve stale, ` +
      `pre-build code. Run \`pnpm build\` and retry. (dist: ${distFile})`,
  );
}

/**
 * Guard for `runServer`: resolves the running dist entry + the sibling `src/` and delegates to
 * {@link checkStaleDist}. Walks up from the running file to the package root (nearest `package.json`).
 */
export function assertDistNotStale(runningFileUrl: string = import.meta.url): void {
  let distFile: string;
  try {
    distFile = fileURLToPath(runningFileUrl);
  } catch {
    return; // not a file URL (e.g. a bundler virtual module) — nothing to check
  }
  // Only meaningful when actually running from a compiled `dist/`. Running the source directly
  // (tsx / vitest / ts-node in a dev checkout) has no stale build to detect — comparing a src
  // file against src would false-positive. No `dist` path segment ⇒ no-op.
  if (!distFile.split(sep).includes('dist')) {
    return;
  }
  // Walk up to the package root (nearest dir containing package.json), bounded.
  let dir = dirname(distFile);
  let srcRoot: string | null = null;
  for (let i = 0; i < 8; i += 1) {
    if (existsSync(join(dir, 'package.json'))) {
      const candidate = join(dir, 'src');
      srcRoot = existsSync(candidate) ? candidate : null;
      break;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  checkStaleDist(distFile, srcRoot);
}
