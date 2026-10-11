/**
 * UI tour — screenshots every main screen of the real app, in light and dark
 * mode, at 1366×768, with a realistic seeded caseload. Used for UI review
 * (before/after polish passes), not as a pass/fail test.
 *
 *   npm run ui-tour                       # → test-results/ui-tour/current/
 *   UI_TOUR_LABEL=before npm run ui-tour  # → test-results/ui-tour/before/
 *
 * Skipped unless UI_TOUR=1 so `npm run test:e2e` doesn't run it.
 */
import { test, type Page } from '@playwright/test'
import { join } from 'path'
import { existsSync, mkdirSync, readFileSync } from 'fs'
import { launchApp, setupPassword, skipOnboarding, startSetup, finishSetup, unlockApp, cleanup, type AppContext } from './helpers'

const PASSWORD = 'TourPassword123!'
const OUT = join(__dirname, '..', 'test-results', 'ui-tour', process.env.UI_TOUR_LABEL || 'current')
const WIDTH = 1366
const HEIGHT = 768

test.skip(!process.env.UI_TOUR, 'UI tour only runs with UI_TOUR=1')
test.setTimeout(10 * 60_000)

async function sizeWindow(ctx: AppContext): Promise<void> {
  await ctx.electronApp.evaluate(({ BrowserWindow }, [w, h]) => {
    const win = BrowserWindow.getAllWindows()[0]
    win?.unmaximize()
    win?.setContentSize(w as number, h as number)
  }, [WIDTH, HEIGHT])
  await ctx.window.waitForTimeout(300)
}

async function setTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await page.evaluate(t => {
    document.documentElement.classList.toggle('dark', t === 'dark')
  }, theme)
  await page.waitForTimeout(150)
}

async function shot(page: Page, name: string, theme: 'light' | 'dark'): Promise<void> {
  await page.waitForTimeout(600) // let lists load and animations settle
  await page.screenshot({ path: join(OUT, `${name}.${theme}.png`) })
}

async function go(page: Page, hash: string): Promise<void> {
  await page.evaluate(h => { window.location.hash = h }, hash)
  await page.waitForTimeout(900)
}

/** Deterministic demo data, created through the app's own IPC channels. */
async function seed(page: Page): Promise<{ firstRowId: number }> {
  return page.evaluate(async () => {
    const api = (window as unknown as { api: { invoke: (c: string, ...a: unknown[]) => Promise<{ ok: boolean; data: any; error?: string }> } }).api
    const inv = async (ch: string, ...args: unknown[]) => {
      const r = await api.invoke(ch, ...args)
      if (!r.ok) throw new Error(`${ch}: ${r.error}`)
      return r.data
    }
    const day = (offset: number) => {
      const d = new Date(); d.setDate(d.getDate() + offset)
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    }
    let s = 7
    const rand = (n: number) => { s = (s * 16807) % 2147483647; return s % n }

    const grids = await inv('grid:get-all')
    const gridId = grids[0].id as number
    const full = await inv('grid:get-full', gridId)
    const nameCol = (full.columns.find((c: any) => c.is_name_column) ?? full.columns[0]).id as number

    const monthly = await inv('alert-rule:create', {
      name: 'Monthly contact', description: null, is_system: 0, interval_days: 30,
      thresholds: JSON.stringify([
        { daysBefore: 14, bgClass: '#facc15', label: 'Due Soon' },
        { daysBefore: 7, bgClass: '#fb923c', label: 'Urgent' },
        { daysBefore: 0, bgClass: '#dc2626', label: 'Due Today' },
        { daysBefore: -1, bgClass: 'alert-pulse-dark', label: 'Overdue' },
      ]),
    })
    const annual = await inv('alert-rule:create', {
      name: 'Annual review', description: null, is_system: 0, interval_days: 365,
      thresholds: JSON.stringify([
        { daysBefore: 60, bgClass: '#bbf7d0', label: 'Upcoming' },
        { daysBefore: 30, bgClass: '#facc15', label: 'Due Soon' },
        { daysBefore: 0, bgClass: '#dc2626', label: 'Due Today' },
        { daysBefore: -1, bgClass: 'alert-pulse-dark', label: 'Overdue' },
      ]),
    })

    const lastContact = Number(await inv('column:create', gridId, 'Last Contact', 'date'))
    await inv('column:update', lastContact, { config: JSON.stringify({ alert_rule_id: Number(monthly) }) })
    const review = Number(await inv('column:create', gridId, 'Annual Review', 'date'))
    await inv('column:update', review, { config: JSON.stringify({ alert_rule_id: Number(annual) }) })
    const program = Number(await inv('column:create', gridId, 'Program', 'text'))
    const phone = Number(await inv('column:create', gridId, 'Phone', 'phone'))
    const dob = Number(await inv('column:create', gridId, 'Date of Birth', 'date'))

    const first = ['Maria', 'James', 'Aisha', 'Robert', 'Linh', 'Dorothy', 'Carlos', 'Priya', 'Frank', 'Keisha']
    const last = ['Garcia', 'Johnson', 'Okafor', 'Smith', 'Nguyen', 'Walker', 'Rivera', 'Patel', 'Miller', 'Brown']
    const programs = ['Waiver', 'Case Management', 'Housing', 'Behavioral Health']
    let firstRowId = 0
    for (let i = 0; i < 40; i++) {
      const rowId = Number(await inv('row:create', gridId))
      if (i === 0) firstRowId = rowId
      await inv('cell:update', rowId, nameCol, `${first[i % 10]} ${last[(i * 3) % 10]}`)
      await inv('cell:update', rowId, lastContact, day(-rand(45)))
      await inv('cell:update', rowId, review, day(-rand(400)))
      await inv('cell:update', rowId, program, programs[rand(4)])
      await inv('cell:update', rowId, phone, `(555) ${String(100 + rand(900))}-${String(1000 + rand(9000))}`)
      await inv('cell:update', rowId, dob, day(-(365 * (25 + rand(50)))))
    }

    await inv('case-log:create', firstRowId, 'Home visit completed. Client doing well; discussed housing application timeline.', 'note', null)
    await inv('case-log:create', firstRowId, 'Called provider about therapy intake — waiting on callback.', 'phone', day(3))
    await inv('case-log:create', firstRowId, 'Annual review packet sent to supervisor.', 'note', day(-2))
    for (const [title, due] of [['Submit monthly billing', 0], ['Update service plans', 5], ['Team meeting prep', -1], ['Renew background check', 20]] as const) {
      await inv('checklist:create-item', firstRowId, title, { due_date: day(due) })
    }
    for (const [title, due, priority] of [['Monthly caseload report', 2, 'high'], ['Order office supplies', 10, 'low'], ['Call county about waiver slots', 0, 'normal'], ['Quarterly audit prep', -3, 'high']] as const) {
      await inv('task:create', {
        grid_id: null, group_id: null, title, description: null, priority, category: null, due_date: day(due),
        recurrence_rule: null, is_completed: 0, completed_at: null, snoozed_until: null, position: 0,
      })
    }
    for (const [name, org, phoneNo] of [['Dr. Ellen Park', 'Riverside Behavioral Health', '(555) 201-3344'], ['Tom Alvarez', 'County Housing Authority', '(555) 390-1200'], ['Sarah Kim', 'Meals on Wheels', '(555) 440-7788']] as const) {
      await inv('contacts:create', { name, org_name: org, phone_main: phoneNo })
    }
    return { firstRowId }
  })
}

/**
 * Starter tour — website screenshots of one starter with its sample data,
 * set up the way a new user would (W16):
 *
 *   UI_TOUR_STARTER=therapy-practice npm run ui-tour
 *   → test-results/ui-tour/starters/therapy-practice/
 *
 * Light mode only: the list, the dashboard, the first sample record's page,
 * the calendar when the starter has sample appointments, the Reports page,
 * and the first report that draws bars.
 */
test('starter tour', async () => {
  const id = process.env.UI_TOUR_STARTER
  test.skip(!id, 'Set UI_TOUR_STARTER=<starter id>')
  const file = join(__dirname, '..', 'src', 'shared', 'starters', `${id}.json`)
  if (!/^[a-z0-9-]+$/.test(id!) || !existsSync(file)) throw new Error(`No built-in starter "${id}"`)
  const starter = JSON.parse(readFileSync(file, 'utf-8')) as { id: string; name: string; variants?: unknown[]; sampleData?: { appointments?: unknown[] } }
  const out = join(__dirname, '..', 'test-results', 'ui-tour', 'starters', starter.id)
  mkdirSync(out, { recursive: true })
  const snap = async (page: Page, name: string) => { await page.waitForTimeout(800); await page.screenshot({ path: join(out, `${name}.png`) }) }

  let ctx = await launchApp()
  try {
    await sizeWindow(ctx)
    await setupPassword(ctx.window, PASSWORD)
    const page = ctx.window
    if (!await startSetup(page)) throw new Error('Expected first-run setup')
    await page.getByRole('button', { name: /start from an example/i }).click()
    await page.getByLabel('Search examples').fill(starter.name)
    await page.getByRole('button', { name: new RegExp(`^${starter.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) }).first().click()
    if (starter.variants?.length) await page.getByRole('button', { name: /^next$/i }).click()
    await page.getByRole('checkbox', { name: /add sample data/i }).check()
    await page.getByRole('button', { name: /^add$/i }).click()
    await page.waitForTimeout(3000)
    await finishSetup(page)

    // Relaunch so every view loads the sample data fresh
    const dataDir = ctx.dataDir
    await ctx.electronApp.close()
    ctx = await launchApp({ fixtureDir: dataDir })
    await sizeWindow(ctx)
    await ctx.window.waitForSelector('input[type="password"]', { timeout: 15000 })
    await unlockApp(ctx.window, PASSWORD)
    const app = ctx.window
    await setTheme(app, 'light')

    const firstRowId = await app.evaluate(async () => {
      const api = (window as unknown as { api: { invoke: (c: string, ...a: unknown[]) => Promise<{ ok: boolean; data: any }> } }).api
      const grids = (await api.invoke('grid:get-all')).data as Array<{ id: number }>
      const full = (await api.invoke('grid:get-full', grids[0]!.id)).data as { rows: Array<{ row_id: number }> }
      return full.rows[0]?.row_id ?? null
    })
    // A newer published release shows an update banner; it isn't part of the starter
    await app.getByRole('button', { name: 'Dismiss update notification' }).click({ timeout: 3000 }).catch(() => {})
    await go(app, '#/grid')
    await snap(app, '01-list')
    await go(app, '#/dashboard')
    await snap(app, '02-dashboard')
    if (firstRowId !== null) {
      await go(app, `#/profile/${firstRowId}`)
      await snap(app, '03-record')
    }
    if (starter.sampleData?.appointments?.length) {
      await go(app, '#/calendar')
      await snap(app, '04-calendar')
    }
    // Reports: the home page of report cards, then the first report drawn as bars
    await go(app, '#/reports')
    await app.getByText('Working…').first().waitFor({ state: 'detached', timeout: 15000 }).catch(() => {})
    await snap(app, '05-reports')
    const charted = app.locator('button:has([class*="space-y-[2px]"])').first()
    if (await charted.count()) {
      await charted.click()
      await snap(app, '06-report')
    }
  } finally {
    await cleanup(ctx)
  }
})

test('UI tour', async () => {
  test.skip(!!process.env.UI_TOUR_STARTER, 'Starter tour only')
  mkdirSync(OUT, { recursive: true })
  let ctx = await launchApp()
  try {
    await sizeWindow(ctx)
    const page = ctx.window

    // First-run screens
    await page.getByText('Create password & continue').waitFor({ timeout: 15000 })
    for (const theme of ['light', 'dark'] as const) {
      await setTheme(page, theme)
      await shot(page, '01-setup', theme)
      await page.getByRole('button', { name: 'Restore from a backup' }).click()
      await shot(page, '02-setup-restore', theme)
      await page.getByRole('button', { name: 'Cancel' }).click()
    }
    await setupPassword(page, PASSWORD)
    for (const theme of ['light', 'dark'] as const) {
      await setTheme(page, theme)
      await shot(page, '03-onboarding-welcome', theme)
    }
    await skipOnboarding(page)
    await page.waitForSelector('nav, [class*="sidebar"]', { timeout: 20000 })

    const { firstRowId } = await seed(page)

    // Relaunch so every view loads the seeded data fresh (like a real restart)
    const dataDir = ctx.dataDir
    await ctx.electronApp.close()
    ctx = await launchApp({ fixtureDir: dataDir })
    await sizeWindow(ctx)
    await ctx.window.waitForSelector('input[type="password"]', { timeout: 15000 })
    for (const theme of ['light', 'dark'] as const) {
      await setTheme(ctx.window, theme)
      await shot(ctx.window, '04-lock', theme)
    }
    await unlockApp(ctx.window, PASSWORD)
    const app = ctx.window

    const screens: Array<[string, string]> = [
      ['10-grid', '#/grid'],
      ['11-dashboard', '#/dashboard'],
      ['12-profile', `#/profile/${firstRowId}`],
      ['13-tasks', '#/tasks'],
      ['14-contacts', '#/contacts'],
      ['15-trash', '#/trash'],
      ['16-snippets', '#/snippets'],
      ['17-checklist-templates', '#/templates'],
      ['18-letter-templates', '#/letter-templates'],
      ['19-settings', '#/settings'],
      ['20-help', '#/help'],
    ]
    for (const theme of ['light', 'dark'] as const) {
      for (const [name, hash] of screens) {
        await go(app, hash)
        await setTheme(app, theme)
        await shot(app, name, theme)
      }
      // Settings sections
      for (const section of ['security', 'backup', 'data', 'alerts']) {
        await go(app, '#/help') // leave Settings so the ?tab= deep link applies on mount
        await go(app, `#/settings?tab=${section}`)
        await setTheme(app, theme)
        await shot(app, `19-settings-${section}`, theme)
      }
      // Add Task dialog
      await go(app, '#/tasks')
      await setTheme(app, theme)
      await app.getByRole('button', { name: '+ Add Task' }).first().click({ timeout: 3000 }).catch(() => {})
      await shot(app, '32-add-task-dialog', theme)
      await app.keyboard.press('Escape')
      // Right-click menu on a client
      await go(app, '#/grid')
      await setTheme(app, theme)
      await app.getByText('Maria Garcia').first().click({ button: 'right', timeout: 3000 }).catch(() => {})
      await shot(app, '33-client-menu', theme)
      await app.keyboard.press('Escape')
      // A few overlays on the grid
      await go(app, '#/grid')
      await setTheme(app, theme)
      await app.keyboard.press('Control+k')
      await shot(app, '30-command-palette', theme)
      await app.keyboard.press('Escape')
      await app.keyboard.press('Control+/')
      await shot(app, '31-shortcuts', theme)
      await app.keyboard.press('Escape')
    }
  } finally {
    await cleanup(ctx)
  }
})
