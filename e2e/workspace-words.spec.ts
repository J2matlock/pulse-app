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
    // 4. Columns — keep the suggestions; this step makes the list
    await window.getByRole('heading', { name: /pick the details/i }).waitFor();
    await window.getByRole('button', { name: /create list/i }).click();
    // 5. Repeating dates (only when a date column was picked)
    // isVisible() doesn't wait, so wait for whichever step comes next
    const dates = window.getByRole('heading', { name: /dates repeat/i });
    await dates.or(window.getByRole('heading', { name: /a few quick questions/i })).first().waitFor();
    if (await dates.isVisible()) {
      await window.getByRole('button', { name: /continue/i }).click();
    }
    // 6. Quick questions
    await window.getByRole('heading', { name: /a few quick questions/i }).waitFor();
    await window.getByRole('button', { name: /finish/i }).click();
    await finishSetup(window);
    // Setup ends on the dashboard; the list is a click away
    await window.evaluate(() => { window.location.hash = '#/grid' })

    await expect(window.getByText('Vehicles').first()).toBeVisible();
    await expect(window.getByRole('button', { name: 'Add vehicle', exact: true })).toBeVisible();
    expect(await window.locator('body').innerText()).not.toMatch(OLD_WORDS);
  });

  test('spreadsheet: rows are named on the import summary', async () => {
    ctx = await launchApp();
    const { window, electronApp, dataDir } = ctx;
    await setupPassword(window, TEST_PASSWORD);
    expect(await startSetup(window)).toBe(true);

    await mockFileDialog(electronApp, [createTestCsv(dataDir)]);
    await window.getByRole('button', { name: /bring in a spreadsheet/i }).click();

    // Import dialog: pick the file; the summary shows the list name and "Each line is one…"
    const importDialog = window.locator('[role="dialog"]');
    await expect(importDialog).toBeVisible({ timeout: 5000 });
    await importDialog.getByRole('button', { name: /browse.*file|drop.*file/i }).click();
    await importDialog.getByLabel('Each line of your spreadsheet is one…').selectOption('other');
    await importDialog.getByLabel('One of them').fill('member');
    await importDialog.getByLabel('More than one', { exact: true }).fill('members');
    await importDialog.getByLabel('List name').fill('Members');
    // Import, then Done (whole names only: the last screen also has "Undo this import")
    for (const name of [/^\s*import\s*$/i, /^\s*done\s*$/i]) {
      const button = importDialog.getByRole('button', { name });
      await button.first().waitFor({ state: 'visible', timeout: 10000 });
      await button.first().click();
    }
    await finishSetup(window);
    await window.evaluate(() => { window.location.hash = '#/grid' })

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
    // The list's own name ("Social Worker Caseload") is the user's data, not a word Pulse chose
    expect((await window.locator('main').innerText()).replace(/Social Worker Caseload/g, '')).not.toMatch(OLD_WORDS);

    // PDF
    const pdfPath = join(dataDir, 'profile.pdf');
    await mockSaveDialog(electronApp, pdfPath);
    // Record page: Print or save → Save as PDF… → Save PDF…
    await window.getByRole('button', { name: 'Print or save', exact: true }).click();
    await window.getByRole('menuitem', { name: /Save as PDF/ }).click();
    await window.getByRole('button', { name: /Save PDF/ }).click();
    await expect.poll(() => existsSync(pdfPath), { timeout: 10000 }).toBe(true);
    const pdf = readFileSync(pdfPath, 'latin1');
    expect(pdf).toMatch(/jot/i);
    // Show where an old word turned up, if one did; the list's own name is the user's data
    expect(pdf.replace(/Social Worker Caseload/g, '').match(new RegExp(`.{0,40}${OLD_WORDS.source}.{0,40}`, 'gi'))).toBeNull();
  });
});
