import { expect, test } from '@playwright/test';

import { mockJson } from './_support/api-mock';

// US5 / US7 / US8 / US9 / US11 — Expo Web e2e against pre-seeded auth state.
//
// 001-phone-sms-auth client (login + onboarding form) was deferred to W4+ in
// spec 001 (tasks.md L42), so we cannot run the full cold-boot login flow
// here. Instead we pre-seed window.localStorage under zustand-persist key
// `nvy-auth` so the AuthGate hydrates into 第三态 (isAuthenticated +
// displayName set) and lands on `/(app)/(tabs)/profile`.
//
// UpdateDisplayName client UI does not exist in mono yet (deferred alongside
// 001 client migration); the server PATCH endpoint is covered end-to-end by
// T023 (apps/server/test/integration/accounts.us2-002.e2e.spec.ts).

const SEED_DISPLAY_NAME = '小明';
const SEED_ACCOUNT_ID = 'acc-e2e-1';
const SEED_REFRESH_TOKEN = 'refresh-e2e-1';
// Phone is cosmetic here (the hero renders displayName, not phone) but the
// AccountProfileResponse contract requires a string, so the GET /me stub carries one.
const SEED_PHONE = '+8613800138000';

const ME_URL = '**/api/v1/accounts/me';
const REFRESH_URL = '**/api/v1/accounts/refresh-token';

const SCREENSHOT_DIR = 'playwright-report/screenshots';

const seedAuthStore = `
  window.localStorage.setItem(
    'nvy-auth',
    JSON.stringify({
      state: {
        accountId: '${SEED_ACCOUNT_ID}',
        refreshToken: '${SEED_REFRESH_TOKEN}',
        displayName: '${SEED_DISPLAY_NAME}',
        phone: null,
      },
      version: 0,
    }),
  );
`;

test.beforeEach(async ({ page }) => {
  await page.addInitScript(seedAuthStore);

  // Stub the authed-boot network boundary so the suite is hermetic regardless of
  // whether a real backend happens to be listening on :3000 (per
  // docs/plans/2026-05/05-29-e2e-backend-boundary-hardening.md P1). The seed has
  // no accessToken (in-memory only on web), so without this stub AuthGate's useMe
  // GET /me would hit a real :3000, 401, fail the fake-refresh, clearSession and
  // bounce to /login — the exact env-dependent flake this plan removes.
  await mockJson(
    page,
    ME_URL,
    200,
    {
      accountId: SEED_ACCOUNT_ID,
      phone: SEED_PHONE,
      displayName: SEED_DISPLAY_NAME,
      status: 'ACTIVE',
      createdAt: '2026-05-25T00:00:00.000Z',
    },
    'GET',
  );
  // Defensive: GET /me 200 means refresh normally never fires, but pin it so any
  // boot-time refresh attempt is answered locally instead of leaking to :3000.
  await mockJson(page, REFRESH_URL, 200, {
    accountId: SEED_ACCOUNT_ID,
    accessToken: 'access-e2e-1',
    refreshToken: SEED_REFRESH_TOKEN,
  });

  page.on('console', (msg) => {
    if (msg.type() === 'error') console.log('[browser-console]', msg.text());
  });
  page.on('pageerror', (e) => console.log('[page-error]', e.message));
});

// Metro web first compile on cold start can take 30-90s; subsequent navigations
// inside the same `expo start` session are fast. Per-test deadline accommodates
// the slow first bundle without flaking on retries.
test.setTimeout(120_000);

async function waitForBootedRoot(page: import('@playwright/test').Page) {
  await page.goto('/');
  // Wait until network goes idle so the JS bundle has finished downloading +
  // executing. Then expect the AuthGate-driven hero displayName text.
  await page.waitForLoadState('networkidle', { timeout: 90_000 });
}

test('US5 — onboarded cold boot lands on (tabs)/profile with hero rendered', async ({ page }) => {
  await waitForBootedRoot(page);
  // AuthGate should replace into /(app)/(tabs)/profile once persist hydrates
  // + nav container mounts. expo-router strips route groups from web URLs,
  // so the visible path is `/profile` rather than `/(app)/(tabs)/profile`.
  await expect(page).toHaveURL(/\/profile$|\(tabs\)\/profile/);

  await expect(page.getByText(SEED_DISPLAY_NAME)).toBeVisible();
  await expect(page.getByText('关注')).toBeVisible();
  await expect(page.getByText('粉丝')).toBeVisible();
  await expect(page.getByText('5', { exact: true })).toBeVisible();
  await expect(page.getByText('12', { exact: true })).toBeVisible();

  await page.screenshot({ path: `${SCREENSHOT_DIR}/us5-profile-landing.png`, fullPage: true });
});

test('US7 — slide tabs default 笔记 + tap 图谱 switches active state', async ({ page }) => {
  await waitForBootedRoot(page);
  await expect(page.getByText(SEED_DISPLAY_NAME)).toBeVisible();

  // Initial state — 笔记 active, content placeholder copy reflects it.
  await expect(page.getByText('笔记内容即将推出')).toBeVisible();

  const graphTab = page.getByRole('tab', { name: '图谱' });
  await graphTab.tap();

  await expect(page.getByText('图谱内容即将推出')).toBeVisible();
  await page.screenshot({ path: `${SCREENSHOT_DIR}/us7-slide-tab-graph.png`, fullPage: true });

  const kbTab = page.getByRole('tab', { name: '知识库' });
  await kbTab.tap();
  await expect(page.getByText('知识库内容即将推出')).toBeVisible();
});

test('US8 — TopNav ⚙️ press triggers router.push for /(app)/settings', async ({ page }) => {
  await waitForBootedRoot(page);
  await expect(page.getByText(SEED_DISPLAY_NAME)).toBeVisible();

  // /(app)/settings is owned by spec B and does not exist in mono yet.
  // Pressing the gear should push the path; assert URL change rather than
  // expecting a destination render. Expo Router will show its Unmatched
  // route screen for missing targets — acceptable for this placeholder
  // boundary check.
  const gearButton = page.getByRole('button', { name: '设置' });
  await gearButton.tap();

  await page.waitForURL(/settings/);
  await page.screenshot({ path: `${SCREENSHOT_DIR}/us8-settings-push.png`, fullPage: true });
});

test('US9 — TopNav ≡ / 🔍 press is noop (no URL change)', async ({ page }) => {
  await waitForBootedRoot(page);
  await expect(page.getByText(SEED_DISPLAY_NAME)).toBeVisible();

  const urlBefore = page.url();
  await page.getByRole('button', { name: '菜单' }).tap();
  await page.getByRole('button', { name: '搜索' }).tap();
  expect(page.url()).toBe(urlBefore);
});

test('US11 — bottom tab bar switches across 4 tabs', async ({ page }) => {
  await waitForBootedRoot(page);
  await expect(page.getByText(SEED_DISPLAY_NAME)).toBeVisible();

  // Expo Router Tabs uses @react-navigation bottom-tabs underneath; tabs
  // expose ARIA role="tab" in the web build. The 我的 tab is the landing —
  // start by switching away then back so we exercise all four targets.
  await page.getByRole('tab', { name: '首页' }).tap();
  await expect(page.getByText('首页内容即将推出')).toBeVisible();
  await page.screenshot({ path: `${SCREENSHOT_DIR}/us11-tab-home.png`, fullPage: true });

  await page.getByRole('tab', { name: '外脑' }).tap();
  await expect(page.getByText('外脑内容即将推出')).toBeVisible();

  await page.getByRole('tab', { name: '投资' }).tap();
  await expect(page.getByText('投资内容即将推出')).toBeVisible();

  await page.getByRole('tab', { name: '我的' }).tap();
  await expect(page.getByText(SEED_DISPLAY_NAME)).toBeVisible();
});
