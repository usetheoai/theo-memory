import { randomUUID } from 'node:crypto';

import { InMemoryMessageLog } from './in-memory-message-log.js';
import { runMessageLogConformance } from './message-log-conformance.js';

runMessageLogConformance('InMemoryMessageLog', () => {
  const log = new InMemoryMessageLog();
  return Promise.resolve({
    log,
    createMemory: () => Promise.resolve(randomUUID()),
    inScope: (_filters, fn) => fn(),
    reset: () => Promise.resolve(),
  });
});
