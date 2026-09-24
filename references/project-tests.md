# Persisting tests in a project

Read this only when the user wants browser tests that live in the project and can run without this skill (e.g. in CI or by teammates).

## Option A — keep `run` scripts (lightest)
Save flows as `.claude/playwright/<name>.mjs` (or the folder the user prefers). They run with:
```bash
node "<skill-dir>/scripts/pw.mjs" run --script .claude/playwright/<name>.mjs --url <base-url>
```
Works in any project (Java, Go, Python, …) because the script doesn't import Playwright. Teammates need this skill installed (and its one-time setup); CI doesn't run them automatically.

## Option B — Playwright Test in a Node project (for CI)
Only when the project has (or wants) a `package.json`, and the user agrees to adding a dev dependency:

```bash
npm i -D @playwright/test
npx playwright install chromium
```

`playwright.config.ts` (minimal):
```ts
import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e',
  use: { baseURL: process.env.BASE_URL ?? 'http://localhost:3000', trace: 'on-first-retry', screenshot: 'only-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    // iPhone presets default to WebKit; pin chromium unless WebKit is installed (node <skill-dir>/scripts/setup.mjs webkit)
    { name: 'mobile', use: { ...devices['iPhone 13'], browserName: 'chromium' } },
  ],
  // Starts the dev server for the run. If the port may already be in use (a dev server you left
  // running, another agent), use reuseExistingServer: true or a dedicated test port.
  // webServer: { command: 'npm run dev', url: 'http://localhost:3000', reuseExistingServer: true },
});
```

Spec (`tests/e2e/pricing.spec.ts`):
```ts
import { test, expect } from '@playwright/test';
test('pricing page', async ({ page }) => {
  await page.goto('/pricing');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Pricing');
  await expect(page).toHaveScreenshot('pricing.png', { maxDiffPixelRatio: 0.01 }); // visual regression
});
```
Accessibility inside a spec: `npm i -D @axe-core/playwright`, then `const r = await new AxeBuilder({ page }).analyze(); expect(r.violations).toEqual([]);`.

Converting a `run` script to a spec is mechanical: wrap the body in `test(...)`, replace `shot(name)` with `page.screenshot({ path })` or `toHaveScreenshot`, and use `page.goto('/path')` with `baseURL`.

Add `test-results/`, `playwright-report/`, `blob-report/` to `.gitignore`. In GitLab CI use the image `mcr.microsoft.com/playwright:v<same-version>-noble` and `npx playwright test`; keep the image version equal to the `@playwright/test` version.

Logged-in tests in CI: use a setup project that logs in with credentials from CI variables and saves `storageState` — never commit session files.
