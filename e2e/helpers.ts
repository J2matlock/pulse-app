/**
 * E2E test helpers for CaseConnect Pulse Electron app.
 *
 * Prerequisites:
 *   1. Run `npm run build` to produce `out/main/index.js`
 *   2. Run `npx playwright test` (NOT part of the vitest suite)
 */

import { _electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtempSync, cpSync, rmSync, existsSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

/** Path to the built main process entry point. */
const MAIN_ENTRY = join(__dirname, '..', 'out', 'main', 'index.js');

export interface AppContext {
  electronApp: ElectronApplication;
  window: Page;
  dataDir: string;
}

/**
 * Launch the Electron app with an isolated data directory.
 * Sets PULSE_DATA_DIR env var so the app writes to a temp folder
 * instead of the real user data path.
 */
export async function launchApp(options?: {
  /** If provided, copy this directory's contents into the temp data dir before launch. */
  fixtureDir?: string;
  /** Extra environment variables. */
  env?: Record<string, string>;
}): Promise<AppContext> {
  const dataDir = mkdtempSync(join(tmpdir(), 'pulse-e2e-'));

  if (options?.fixtureDir && existsSync(options.fixtureDir)) {
    cpSync(options.fixtureDir, dataDir, { recursive: true });
  }

  const electronApp = await _electron.launch({
    args: [MAIN_ENTRY],
    env: {
      ...process.env,
      PULSE_DATA_DIR: dataDir,
      NODE_ENV: 'test',
      ...options?.env,
    },
  });

  // Wait for the first BrowserWindow to open
  const window = await electronApp.firstWindow();
  await window.waitForLoadState('domcontentloaded');

  return { electronApp, window, dataDir };
}

/**
 * Wait until the lock screen is visible, indicating the app has loaded
 * and a password has been previously set.
 */
export async function waitForLockScreen(window: Page): Promise<void> {
  await window.waitForSelector('input[type="password"]', { timeout: 15000 });
}

/**
 * Wait until the password setup screen is visible (first-run flow).
 */
export async function waitForPasswordSetup(window: Page): Promise<void> {
  // Wait for password setup heading or the create button
  await window.getByText('Create password & continue').waitFor({ timeout: 15000 });
}

/**
 * Complete the password setup flow by entering a password and confirming it.
 * Returns after the app transitions past the setup screen.
 */
export async function setupPassword(window: Page, password: string): Promise<void> {
  await waitForPasswordSetup(window);

  // Fill in password fields — there should be at least two (password + confirm)
  const passwordInputs = await window.locator('input[type="password"]').all();
  if (passwordInputs.length >= 2) {
    await passwordInputs[0]!.fill(password);
    await passwordInputs[1]!.fill(password);
  } else if (passwordInputs.length === 1) {
    await passwordInputs[0]!.fill(password);
  }

  // Accept Terms of Service checkbox (required to enable the submit button)
  const tosCheckbox = window.locator('input[type="checkbox"]');
  if (await tosCheckbox.isVisible({ timeout: 2000 }).catch(() => false)) {
    await tosCheckbox.check();
  }

  // Click the submit/create button
  await window.getByText('Create password & continue').click();

  // After password setup, the recovery key prompt appears.
  // Click "skip" then confirm to proceed quickly in tests.
  const skipRecovery = window.getByText('I understand the risk — skip recovery key');
  await skipRecovery.waitFor({ timeout: 10000 });
  await skipRecovery.click();

  // Confirm the skip dialog (exact match to avoid hitting the "skip recovery key" button)
  const skipConfirm = window.getByRole('button', { name: 'Skip', exact: true });
  await skipConfirm.waitFor({ timeout: 5000 });
  await skipConfirm.click();

  // Wait for transition to onboarding or main app
  await window.waitForTimeout(2000);
}

/**
 * Unlock the app by entering the password on the lock screen.
 */
export async function unlockApp(window: Page, password: string): Promise<void> {
  await waitForLockScreen(window);

  const passwordInput = window.locator('input[type="password"]');
  await passwordInput.fill(password);

  // Click the Unlock button
  await window.getByRole('button', { name: 'Unlock' }).click();

  // Wait for the main app UI to appear
  await window.waitForSelector('nav, [class*="sidebar"]', { timeout: 15000 });
}

/**
 * Set up a fresh app: launch, create password, and get past any onboarding.
 * Returns the app context with the main UI visible.
 */
export async function launchAndSetup(password: string): Promise<AppContext> {
  const ctx = await launchApp();
  await setupPassword(ctx.window, password);

  // After password setup, the app may show lock screen or go straight to main UI
  try {
    const lockInput = await ctx.window.waitForSelector('input[type="password"]', { timeout: 3000 });
    if (lockInput) {
      await unlockApp(ctx.window, password);
    }
  } catch {
    // No lock screen — app went directly to main UI or onboarding
  }

  return ctx;
}

/**
 * First-run setup up to "How do you want to start?": welcome → your name
 * (left blank). Returns false when there is no setup to do.
 */
export async function startSetup(window: Page): Promise<boolean> {
  const getStarted = window.getByRole('button', { name: /get started/i });
  if (!await getStarted.isVisible({ timeout: 5000 }).catch(() => false)) return false;
  await getStarted.click();
  await window.waitForTimeout(500);

  const continueBtn = window.getByRole('button', { name: /continue/i });
  await continueBtn.waitFor({ state: 'visible', timeout: 5000 });
  await continueBtn.click();
  await window.getByRole('heading', { name: /how do you want to start/i }).waitFor({ timeout: 5000 });
  return true;
}

/** Leave the "Your workspace is ready" screen without the tour. */
export async function finishSetup(window: Page): Promise<void> {
  const exploreBtn = window.getByText(/explore on my own/i);
  await exploreBtn.waitFor({ state: 'visible', timeout: 10000 });
  await exploreBtn.click();
  await window.waitForSelector('nav, [class*="sidebar"]', { timeout: 20000 });
}

/**
 * Navigate through first-run setup quickly.
 * Flow: welcome → your name → start from an example (Human services) → done → main UI
 */
export async function skipOnboarding(window: Page): Promise<void> {
  if (!await startSetup(window)) return; // No onboarding — already on main UI

  // Step 3: How do you want to start? — from an example: Human services, first layout,
  // so tests see today's words (clients, caseloads) and a caseload with deadline columns
  await window.getByRole('button', { name: /start from an example/i }).click();
  const humanServices = window.getByRole('button', { name: /human services/i });
  await humanServices.waitFor({ state: 'visible', timeout: 5000 });
  await humanServices.click();
  await window.getByRole('button', { name: /^next$/i }).click();
  const addBtn = window.getByRole('button', { name: /^add$/i });
  await addBtn.waitFor({ state: 'visible', timeout: 5000 });
  await addBtn.click();
  await window.waitForTimeout(3000); // List creation takes a moment

  // Step 4: Done — click "No thanks, I'll explore on my own"
  await finishSetup(window);
}

/**
 * Full setup: launch → password → skip recovery → onboarding → main UI ready.
 * After password setup + skip recovery key, the app goes directly to onboarding
 * (not lock screen), since finishSetup() calls setLocked(false).
 */
export async function launchToMainUI(password: string): Promise<AppContext> {
  const ctx = await launchApp();
  await setupPassword(ctx.window, password);

  // Navigate through onboarding
  await skipOnboarding(ctx.window);

  // Wait for main UI (sidebar)
  await ctx.window.waitForSelector('nav, [class*="sidebar"]', { timeout: 20000 });

  return ctx;
}

/**
 * Create a minimal CSV file in the given directory for import testing.
 * Returns the absolute path to the CSV file.
 */
export function createTestCsv(dir: string, filename = 'test-import.csv'): string {
  const csvContent = [
    'First Name,Last Name,Phone,Status',
    'Alice,Johnson,555-0101,Active',
    'Bob,Smith,555-0102,Active',
    'Carol,Williams,555-0103,Inactive',
  ].join('\n');

  const filePath = join(dir, filename);
  writeFileSync(filePath, csvContent, 'utf-8');
  return filePath;
}

/**
 * Clean up: close the app and remove the temp data directory.
 */
export async function cleanup(ctx: AppContext): Promise<void> {
  try {
    await ctx.electronApp.close();
  } catch {
    // App may have already closed
  }

  try {
    if (existsSync(ctx.dataDir)) {
      rmSync(ctx.dataDir, { recursive: true, force: true });
    }
  } catch {
    // Best-effort cleanup
  }
}

/**
 * Mock Electron's dialog.showOpenDialog to return a specific file path.
 * Useful for import/backup tests that trigger native file dialogs.
 */
export async function mockFileDialog(
  electronApp: ElectronApplication,
  filePaths: string[]
): Promise<void> {
  await electronApp.evaluate(
    async ({ dialog }, paths) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: paths,
      });
    },
    filePaths
  );
}

/**
 * Mock Electron's dialog.showSaveDialog to return a specific file path.
 */
export async function mockSaveDialog(
  electronApp: ElectronApplication,
  filePath: string
): Promise<void> {
  await electronApp.evaluate(
    async ({ dialog }, savePath) => {
      dialog.showSaveDialog = async () => ({
        canceled: false,
        filePath: savePath,
      });
    },
    filePath
  );
}
