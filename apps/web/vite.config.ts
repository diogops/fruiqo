import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// O contrato é consumido pelo código-fonte TS (o dist é CommonJS, que o Vite não pré-empacota em pacote linkado).
const contracts = fileURLToPath(new URL('../../packages/contracts/src/index.ts', import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@fruiqo/contracts': contracts } },
  server: { port: 5173, strictPort: true },
  test: {
    environment: 'jsdom',
    setupFiles: ['src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
