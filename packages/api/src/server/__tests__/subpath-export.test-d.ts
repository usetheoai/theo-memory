/**
 * T1.7 RED — EC-25 subpath export typecheck contract.
 *
 * Asserts `@usetheo/memory/server` resolves to the `createServer` factory
 * at the public API surface. The subpath is ESM-only (matches the package's
 * `"type": "module"`); CJS consumers will see a clear ESM-resolution error
 * from Node's loader.
 *
 * @see Plan theo-memory-standalone-p0 § T1.7 + EC-25
 */
import { createServer } from '@usetheo/memory-api';
import type { CreateServerOptions } from '@usetheo/memory-api';
import { expectTypeOf, test } from 'vitest';

test('25. @usetheo/memory/server exports createServer factory', () => {
  expectTypeOf(createServer).toBeFunction();
});

test('26. @usetheo/memory/server exports CreateServerOptions type', () => {
  expectTypeOf<CreateServerOptions>().toHaveProperty('memory');
});
