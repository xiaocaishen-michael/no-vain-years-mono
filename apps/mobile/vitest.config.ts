import { defineConfig } from 'vitest/config';

// T038 ships logic-only unit tests; profile screen / sticky tabs / bottom tab
// bar are covered end-to-end by T040 Playwright (Expo Web). Vitest scope is
// limited to lib/ so it never touches the app/ tree (which would require RN→
// DOM translation via react-native-web + reanimated/svg shims — high cost,
// duplicates Playwright coverage).
export default defineConfig({
  resolve: {
    conditions: ['no-vain-years-mono', 'node'],
  },
  test: {
    include: ['lib/**/*.spec.ts'],
    environment: 'node',
    globals: false,
  },
});
