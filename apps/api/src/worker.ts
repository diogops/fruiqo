import { loadEnv } from './config/env.js';
import { startWorker } from './worker-runtime.js';

const runtime = await startWorker(loadEnv());

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    runtime.close().finally(() => process.exit(0));
  });
}
