import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// SWC em vez de esbuild: o Nest precisa de emitDecoratorMetadata para injeção por tipo.
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['test/**/*.test.ts'],
    globalSetup: ['test/global-setup.ts'],
    fileParallelism: false,
    env: { AUTH_RATE_LIMIT_PER_MIN: '10000', API_RATE_LIMIT_PER_MIN: '10000' },
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
