import { type Page, type Route } from '@playwright/test';

// Shared Expo Web e2e backend mock. apps/mobile's axios baseURL defaults to
// http://localhost:3000, so API traffic is cross-origin vs the Expo web origin —
// every mocked call therefore needs its CORS preflight (OPTIONS) answered too,
// not just the actual verb. No credentials are sent pre-auth (accessToken is
// null), so `Access-Control-Allow-Headers: *` covers the custom headers
// (x-trace-id / x-device-*); add the verb to allow-methods if a UC needs it.
//
// Extracted from the login slice (T066) so every API-calling UC e2e (onboarding
// PATCH displayName, …) reuses the preflight handling instead of re-deriving it.
export async function mockJson(page: Page, urlGlob: string, status: number, body: unknown) {
  await page.route(urlGlob, async (route: Route) => {
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({
        status: 204,
        headers: {
          'access-control-allow-origin': '*',
          'access-control-allow-methods': 'GET, POST, PATCH, DELETE, OPTIONS',
          'access-control-allow-headers': '*',
        },
      });
      return;
    }
    await route.fulfill({
      status,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify(body),
    });
  });
}
