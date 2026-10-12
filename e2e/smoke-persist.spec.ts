/**
 * Smoke test (sweep plan Phase 4): launch → set a password → add a record →
 * edit a cell → quit → relaunch on the same data folder → unlock → the edit
 * is still there. Strict on purpose: every step must happen, nothing is
 * skipped when a control isn't found.
 *
 * Run with `npm run test:e2e` (needs a build).
 */
import { test, expect } from '@playwright/test';
import { launchApp, setupPassword, skipOnboarding, unlockApp, cleanup, type AppContext } from './helpers';

const TEST_PASSWORD = 'TestPassword123!';
const VALUE = 'Smoke Persist 4711';

test.describe('Smoke: an edit survives quit and relaunch', () => {
  let ctx: AppContext | undefined;

  test.afterEach(async () => {
    if (ctx) await cleanup(ctx);
  });

  test('set password, add a record, edit a cell, relaunch, unlock, edit is there', async () => {
    ctx = await launchApp();
    const first = ctx.window;
    await setupPassword(first, TEST_PASSWORD);
    await skipOnboarding(first);
    await first.waitForSelector('[role="grid"]', { timeout: 20000 });

    // Add a record: the grid opens the new record's first editable cell for typing
    const rowsBefore = await first.locator('[role="grid"] [role="row"]').count();
    await first.getByRole('button', { name: 'Add client', exact: true }).click();
    const editor = first.locator('[role="grid"] input:focus, [role="grid"] textarea:focus');
    await expect(editor).toBeVisible({ timeout: 5000 });
    await expect(first.locator('[role="grid"] [role="row"]')).toHaveCount(rowsBefore + 1);

    // Edit the cell and commit it
    await editor.fill(VALUE);
    await editor.press('Enter');
    await expect(first.locator('[role="grid"]').getByText(VALUE, { exact: true })).toBeVisible({ timeout: 5000 });

    // Quit and relaunch on the same data folder
    const dataDir = ctx.dataDir;
    await ctx.electronApp.close();
    ctx = await launchApp({ dataDir });
    const second = ctx.window;

    // Unlock, and the edit is still there
    await unlockApp(second, TEST_PASSWORD);
    await second.waitForSelector('[role="grid"]', { timeout: 20000 });
    await expect(second.locator('[role="grid"]').getByText(VALUE, { exact: true })).toBeVisible({ timeout: 10000 });
  });
});
