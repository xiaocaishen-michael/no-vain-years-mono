import { defineConfig, devices } from '@playwright/test';

// D12 — Playwright drives Expo Web build of apps/mobile. expo-secure-store
// falls back to localStorage on web; tests assume that pathway.
//
// Screenshots from page.screenshot() land under playwright-report/screenshots
// (per plan.md § Architecture Notes — Mobile side, Playwright Expo Web).
const PORT = Number(process.env['EXPO_WEB_PORT'] ?? 4173);

export default defineConfig({
  testDir: './e2e',
  outputDir: './playwright-report/test-results',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 2 : 0,
  workers: process.env['CI'] ? 1 : undefined,
  reporter: [['html', { outputFolder: 'playwright-report', open: 'never' }]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    // Expo's web dev server warms Metro + bundles RN→DOM via react-native-web
    // (transitively installed via expo + nativewind). reuseExistingServer keeps
    // local iterations fast; CI always boots a fresh instance.
    command: `pnpm exec expo start --web --port ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env['CI'],
    timeout: 180_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
