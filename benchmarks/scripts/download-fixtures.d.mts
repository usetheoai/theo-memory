/**
 * TypeScript declarations for download-fixtures.mjs.
 *
 * v0-8-fixes-cycle-1 T1.3: the downloader is plain JS (.mjs) per
 * Drift-T2.1-1 (to avoid introducing tsx as a new devDep). Test code
 * imports the exported helpers under TypeScript; this .d.mts file
 * surfaces the types for tsc + eslint without changing the runtime.
 */

export interface FixtureManifestEntry {
  readonly name: string;
  readonly url: string;
  readonly relPath: string;
  readonly licenseBanner: string;
}

export const FIXTURES: readonly FixtureManifestEntry[];

export function getRemoteSize(url: string): Promise<number | null>;

export function getLocalSize(path: string): Promise<number | null>;

export function downloadToFile(url: string, destPath: string): Promise<void>;

export function downloadFixture(fixture: FixtureManifestEntry): Promise<void>;

export function main(): Promise<void>;
