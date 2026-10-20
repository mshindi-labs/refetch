import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    testTimeout: 5_000,
    typecheck: {
      enabled: true,
      include: ['test/**/*.test-d.ts'],
      tsconfig: './tsconfig.test.json',
    },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      reporter: ['text', 'lcov'],
      thresholds: {
        lines: 80,
        statements: 80,
        functions: 80,
        branches: 75,
      },
    },
  },
});
