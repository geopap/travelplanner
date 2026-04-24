import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['src/__tests__/**/*.test.ts', 'src/__tests__/**/*.test.tsx'],
    exclude: ['e2e/**', 'node_modules/**', '.next/**'],
    testTimeout: 10_000,
    setupFiles: ['src/__tests__/setup/env.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
