/**
 * Workspace words and the three ways to start (plans/generalization/W01-workspace.md §8).
 *
 * Run with `npm run test:e2e` (needs a build). Each test uses its own data folder.
 */
import { test, expect } from '@playwright/test';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import {
  launchApp,
  launchToMainUI,
  setupPassword,
  startSetup,
  finishSetup,
  createTestCsv,
  mockFileDialog,
  mockSaveDialog,
  cleanup,
  type AppContext,
} from './helpers';

const TEST_PASSWORD = 'TestPassword123!';
const OLD_WORDS = /\b(clients?|caseloads?|case notes?)\b/i;

test.describe('Three ways to start', () => {
  let ctx: AppContext;

  test.afterEach(async () => {
    if (ctx) await cleanup(ctx);
  });

  test('from an example: the human-services words are used', async () => {
    ctx = await launchApp();
    const { window } = ctx;
    await setupPassword(window, TEST_PASSWORD);
    expect(await startSetup(window)).toBe(true);

    await window.getByRole('button', { name: /start from an example/i }).click();
    await window.getByRole('button', { name: /human services/i }).click();
    await window.getByRole('button', { name: /^next$/i }).click();
    await window.getByRole('button', { name: /^add$/i }).click();
    await finishSetup(window);

    await expect(window.getByRole('button', { name: 'Add client', exact: true })).toBeVisible({ timeout: 10000 });
  });

  test('blank: the list, its words and columns come from the answers', async () => {
    ctx = await launchApp();
    const { window } = ctx;
    await setupPassword(window, TEST_PASSWORD);
    expect(await startSetup(window)).toBe(true);

    await window.getByRole('button', { name: /start blank/i }).click();

    // 1. Name
    await window.getByLabel('List name').fill('Vehicles');
    await window.getByRole('button', { name: /continue/i }).click();
    // 2. Kind
    await window.getByText('Things', { exact: true }).click();
    await window.getByRole('button', { name: /continue/i }).click();
    // 3. Words — prefilled from the list name
    await expect(window.getByLabel('One', { exact: true })).toHaveValue('vehicle');
    await expect(window.getByLabel('More than one')).toHaveValue('vehicles');
    await window.getByRole('button', { name: /continue/i }).click();
    // 4. Columns — keep the suggestions
    await window.getByRole('heading', { name: /pick the details/i }).waitFor();
    await window.getByRole('button', { name: /continue/i }).click();
    // 5. Repeating dates (only when a date column was picked)
    const dates = window.getByRole('heading', { name: /dates repeat/i });
    if (await dates.isVisible({ timeout: 3000 }).catch(() => false)) {
      await window.getByRole('button', { name: /^skip$/i }).click();
    }
    // 6. Quick questions
    await window.getByRole('heading', { name: /a few quick questions/i }).waitFor();
    await window.getByRole('button', { name: /finish/i }).click();
    await finishSetup(window);

    await expect(window.getByText('Vehicles').first()).toBeVisible();
    await expect(window.getByRole('button', { name: 'Add vehicle', exact: true })).toBeVisible();
    expect(await window.locator('body').innerText()).not.toMatch(OLD_WORDS);
  });

  test('spreadsheet: rows are named in the "What are these rows?" step', async () => {
    ctx = await launchApp();
    const { window, electronApp, dataDir } = ctx;
    await setupPassword(window, TEST_PASSWORD);
    expect(await startSetup(window)).toBe(true);

    await mockFileDialog(electronApp, [createTestCsv(dataDir)]);
    await window.getByRole('button', { name: /bring in a spreadsheet/i }).click();
    await window.getByLabel('List name').fill('Members');
    await window.getByRole('button', { name: /choose file/i }).click();

    // Import dialog: pick the file and click through to the end
    const importDialog = window.locator('[role="dialog"]');
    await expect(importDialog).toBeVisible({ timeout: 5000 });
    await importDialog.getByRole('button', { name: /browse.*file|drop.*file/i }).click();
    for (let i = 0; i < 6; i++) {
      const next = importDialog.getByRole('button', { name: /next|import|finish|done|confirm/i });
      if (!await next.first().isVisible({ timeout: 2000 }).catch(() => false)) break;
      await next.first().click();
      await window.waitForTimeout(1000);
    }

    await window.getByRole('heading', { name: /what are these rows/i }).waitFor({ timeout: 10000 });
    await window.getByText('Something else', { exact: true }).click();
    await window.getByLabel('One of them').fill('member');
    await window.getByLabel('More than one', { exact: true }).fill('members');
    await window.getByRole('button', { name: /continue/i }).click();

    const dates = window.getByRole('heading', { name: /which of these dates repeat/i });
    if (await dates.isVisible({ timeout: 3000 }).catch(() => false)) {
      await window.getByRole('button', { name: /finish/i }).click();
    }
    await finishSetup(window);

    await expect(window.getByText('Alice').first()).toBeVisible({ timeout: 10000 });
    await expect(window.getByRole('button', { name: 'Add member', exact: true })).toBeVisible();
  });
});

test.describe('Changing the workspace words', () => {
  let ctx: AppContext;

  test.afterEach(async () => {
    if (ctx) await cleanup(ctx);
  });

  test('a new word shows in the sidebar, list, profile and PDF', async () => {
    ctx = await launchToMainUI(TEST_PASSWORD);
    const { window, electronApp, dataDir } = ctx;

    // Settings → Workspace → Words
    await window.evaluate(() => { window.location.hash = '#/settings?tab=workspace'; });
    await window.getByLabel('What you track: one').fill('widget');
    await window.getByLabel('What you track: more than one').fill('widgets');
    await window.getByLabel('Lists: one').fill('bin');
    await window.getByLabel('Lists: more than one').fill('bins');
    await window.getByLabel('Notes: one').fill('jot');
    await window.getByLabel('Notes: more than one').fill('jots');
    await window.getByRole('button', { name: 'Save words' }).click();
    await window.waitForTimeout(500);

    // Sidebar and list
    await window.evaluate(() => { window.location.hash = '#/grid'; });
    await expect(window.getByRole('button', { name: 'New bin' }).first()).toBeVisible({ timeout: 10000 });
    await expect(window.getByRole('button', { name: 'Add widget', exact: true })).toBeVisible();
    await expect(window.getByPlaceholder(/search widgets/i)).toBeVisible();

    // Profile
    await window.getByRole('button', { name: 'Add widget', exact: true }).click();
    await window.waitForTimeout(500);
    await window.getByRole('button', { name: /open widget profile/i }).first().click();
    await expect(window.getByText(/jots?/i).first()).toBeVisible({ timeout: 10000 });
    expect(await window.locator('main').innerText()).not.toMatch(OLD_WORDS);

    // PDF
    const pdfPath = join(dataDir, 'profile.pdf');
    await mockSaveDialog(electronApp, pdfPath);
    await window.getByRole('button', { name: 'Export PDF' }).click();
    await expect.poll(() => existsSync(pdfPath), { timeout: 10000 }).toBe(true);
    const pdf = readFileSync(pdfPath, 'latin1');
    expect(pdf).toMatch(/jot/i);
    expect(pdf).not.toMatch(OLD_WORDS);
  });
});
