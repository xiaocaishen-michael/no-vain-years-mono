import { defineConfig, devices } from '@playwright/test';

// Runtime-smoke variant of playwright.config.ts.
//
// Differences from playwright.config.ts (per ADR-0040 multi-layer test gate
// strategy / sub-plan 2):
//   - webServer.command serves the static `expo export -p web` output via
//     `serve --single` (history-api-fallback ON for Expo Router paths)
//     instead of running the Metro dev server. CI-friendly: 1-5s cold boot
//     vs 15-30s for `expo start --web`; bit-stable bundle = no Metro
//     race conditions.
//   - reuseExistingServer is always false — runtime-smoke must boot a fresh
//     server every run to catch state drift (we do NOT want a stale serve
//     process from a previous failed run masking new errors).
//
// All other config (testDir / projects / hasTouch / outputs) mirrors the
// dev-server config so the same Playwright spec files run unchanged.
const PORT = Number(process.env['EXPO_WEB_PORT'] ?? 4173);

export default defineConfig({
  testDir: './e2e',
  // real-backend.spec.ts is the ONE non-hermetic spec; it needs a real server +
  // SMOKE_* env and runs ONLY via playwright.real-backend.config.ts (the
  // e2e-real-backend target). Exclude it here so the hermetic runtime-smoke
  // suite doesn't pick it up and crash at its import-time env guard.
  testIgnore: 'real-backend.spec.ts',
  outputDir: './playwright-test-results',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  // Each spec stubs its own network boundary (per 05-29-e2e-backend-boundary-
  // hardening P1), so the suite is hermetic and parallel-safe — workers:1 is no
  // longer needed to avoid storageState cross-talk. retries:1 + trace stays only
  // as a flake probe (quarantine + fix root cause, per Fowler nonDeterminism),
  // NOT as the retries:2 mask that previously hid env-dependent failures.
  retries: process.env['CI'] ? 1 : 0,
  reporter: [['html', { outputFolder: 'playwright-report', open: 'never' }]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], hasTouch: true },
    },
  ],
  webServer: {
    // `serve --single` serves dist/ with history-api-fallback (Expo Router
    // requires this — any /profile etc. must resolve to index.html on hit).
    // `-l tcp://127.0.0.1:${PORT}` pins to IPv4 (avoids dual-stack flake).
    command: `pnpm exec serve dist --single --listen tcp://127.0.0.1:${PORT}`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: false,
    timeout: 30_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
