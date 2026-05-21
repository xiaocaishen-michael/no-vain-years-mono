import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    conditions: ['no-vain-years-mono', 'node'],
  },
  test: {
    include: ['src/**/*.spec.ts'],
    environment: 'node',
    globals: false,
  },
});
