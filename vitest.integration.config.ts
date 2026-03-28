import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.integration.{test,spec}.ts'],
    testTimeout: 120_000,
    hookTimeout: 60_000,
  },
});
