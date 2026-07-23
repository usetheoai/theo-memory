/**
 * Type surface of the M6/M12 Claude-Code-memory migrator (`migrate-claude-code.mjs`).
 * The engine stays plain .mjs (byte-parity constraint with the kit's standalone scrub copy);
 * this declaration types the seam `run-import.ts` consumes.
 */
export declare const CHUNK_SIZE: number;
export declare const CHUNK_MAX_BYTES: number;
export declare function chunkByBytes(items: unknown[], chunkSize: number, maxBytes: number): unknown[][];
export declare const SECRET_DOMINATED_RATIO: number;
export declare const DEFAULT_ENDPOINT: string;
export declare class MigrationHttpError extends Error {}
export declare function scrub(text: string): {
  clean: string;
  redactedChars: number;
  originalChars: number;
  kinds: string[];
  hadPrivateKey: boolean;
};
export declare function parseNode(raw: string, filename: string): unknown;
export declare function nodeToBatchItem(node: unknown, opts: unknown): unknown;
export declare function planMigration(sourceDir: string, opts?: { userId?: string }): {
  items: unknown[];
  report: { scanned: number; wouldImport: number; redacted: number; skipped: unknown[]; nodes: unknown[] };
};
export declare function importBatch(
  items: unknown[],
  opts: { endpoint: string; token?: string; pathPrefix?: string; chunkSize?: number; maxBytes?: number },
): Promise<{ imported: number; deduped: number; failed: number; requests: number }>;
export declare function parseKitEnvFile(path: string): Record<string, string>;
export declare function resolveImportEndpoint(
  env: Record<string, string | undefined>,
  fileVars: Record<string, string>,
): { url: string | undefined; pathPrefix: string; token: string | undefined; userId: string | undefined };
export declare function parseArgs(argv: string[]): { commit?: boolean; help?: boolean; source?: string };
export declare function main(argv?: string[]): Promise<void>;
