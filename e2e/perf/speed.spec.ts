/**
 * "Speed you can feel" in the real app (plan-Q9 Q9a.2): profile open from
 * the list, dialog open, command palette and list search, list scrolling, and
 * the first visit of the lazily loaded views. Skips unless PULSE_PERF=1.
 *
 *   env -u WAYLAND_DISPLAY XDG_SESSION_TYPE=x11 npm run perf:e2e
 *   env -u WAYLAND_DISPLAY XDG_SESSION_TYPE=x11 PULSE_PERF_RECORDS=600,5000 PERF_OUT_DIR=/tmp/perf npm run perf:e2e
 *
 * Each record count is seeded once (a few seconds through the CSV import);
 * every test then relaunches and unlocks on that data, so it starts cold.
 * Targets (plan-Q9): profile settled < 150 ms; dialog painted ≤ 100 ms and
 * animation done ≤ 200 ms; palette results ≤ 50 ms after a key; scroll p95
 * frame ≤ 16.7 ms with < 5 % of frames over 25 ms.
 */
import { test, type Page } from '@playwright/test'
import { rmSync } from 'fs'
import {
  PERF, RECORD_COUNTS, CPU_RATES, skipUnlessPerf, seedWorkspace, openSeeded, closeApp, ipc, waitQuiet, throttleCpu,
  measure, typeAndTime, frameSampler, add, report, type Seeded, type Timing, type AppContext,
} from './perfKit'

const DIALOG = '[role="dialog"], [role="alertdialog"]'
const UNDO_TOAST = '[data-testid="undo-toast-slot"] [role="status"]'
const ROWS = '[role="grid"] [role="row"][data-row-index]'

/** Run `fn` at each CPU rate; rates above 1 only when throttling works here */
async function atEachCpu(page: Page, fn: (cpu: number) => Promise<void>): Promise<void> {
  for (const rate of CPU_RATES) {
    if (rate > 1 && !await throttleCpu(page, rate)) continue
    try { await fn(rate) } finally { if (rate > 1) await throttleCpu(page, 1) }
  }
}

async function closeDialog(page: Page): Promise<void> {
  await page.keyboard.press('Escape')
  await page.waitForFunction(sel => !document.querySelector(sel), DIALOG, { timeout: 5000 }).catch(() => {})
  await waitQuiet(page, 400)
}

function addTimings(spec: string, name: string, records: number, cpu: number, runs: Timing[], fields: Array<[keyof Timing, string]>): void {
  const errors = [...new Set(runs.map(r => r.error).filter(Boolean))]
  // The element that changed last most often: what "settled" waited for
  const lasts = new Map<string, number>()
  for (const r of runs) if (r.lastChangeOn) lasts.set(r.lastChangeOn, (lasts.get(r.lastChangeOn) ?? 0) + 1)
  const last = [...lasts].sort((a, b) => b[1] - a[1])[0]?.[0]
  for (const [field, label] of fields) {
    const notes = [...errors, ...(field === 'settled' && last ? [`last change: ${last}`] : [])]
    add(spec, `${name}: ${label}`, records, cpu, runs.map(r => r.error && !r[field] ? null : r[field] as number | null), 'ms', notes.length ? notes.join('; ') : undefined)
  }
}

for (const records of RECORD_COUNTS) {
  test.describe.serial(`speed at ${records} records`, () => {
    skipUnlessPerf()
    let seeded: Seeded
    let ctx: AppContext | undefined

    test.beforeAll(async () => {
      test.setTimeout(30 * 60_000)
      if (!PERF) return
      const t0 = Date.now()
      seeded = await seedWorkspace(records)
      console.log(`[perf:e2e] seeded ${seeded.total} records (${seeded.records} + the example's) × ${seeded.columns} columns in ${Math.round((Date.now() - t0) / 1000)} s`)
    })
    test.afterEach(async () => { if (ctx) await closeApp(ctx); ctx = undefined })
    test.afterAll(() => { if (seeded) rmSync(seeded.dataDir, { recursive: true, force: true }) })

    test('profile open from the list, and back', async () => {
      const spec = 'Profile open'
      ctx = await openSeeded(seeded)
      const page = ctx.window
      await atEachCpu(page, async cpu => {
        const open: Timing[] = [], back: Timing[] = []
        for (let k = 0; k < 10; k++) {
          await waitQuiet(page, 500)
          open.push(await measure(page, { kind: 'click', selector: `[role="row"][data-row-index="${k}"] [role="gridcell"][aria-colindex="2"] button` }, { ready: 'main h1' }))
          await waitQuiet(page, 500)
          back.push(await measure(page, { kind: 'back' }, { ready: ROWS }))
        }
        addTimings(spec, 'list → record page', records, cpu, open, [['ready', 'name in DOM'], ['painted', 'painted'], ['settled', 'settled']])
        addTimings(spec, 'Back → list', records, cpu, back, [['ready', 'rows in DOM'], ['settled', 'settled']])
      })
      report(spec)
    })

    test('dialogs open', async () => {
      const spec = 'Dialog open'
      ctx = await openSeeded(seeded)
      const page = ctx.window
      const fields: Array<[keyof Timing, string]> = [['painted', 'painted'], ['animDone', 'animation done'], ['settled', 'settled']]
      const RUNS = 5
      await atEachCpu(page, async cpu => {
        // The list: Add column, a record's ⋯ → Move to the Trash, Ctrl+K
        await page.evaluate(() => { window.location.hash = '#/grid' })
        await page.waitForSelector(ROWS)
        await waitQuiet(page, 500)
        const addColumn: Timing[] = [], trash: Timing[] = [], palette: Timing[] = [], pdf: Timing[] = [], settings: Timing[] = []
        for (let i = 0; i < RUNS; i++) {
          addColumn.push(await measure(page, { kind: 'click', selector: 'button', text: 'Add column' }, { ready: DIALOG, anim: true }))
          await closeDialog(page)
          await page.locator('[role="row"][data-row-index="0"] [data-testid="row-menu-button"]').click()
          await page.waitForSelector('[role="menu"]')
          // No confirmation since Q4: the record goes at once and the Undo toast shows; its Undo brings it back
          trash.push(await measure(page, { kind: 'click', selector: '[role="menu"] button, [role="menuitem"]', text: 'Move to the Trash' }, { ready: UNDO_TOAST, anim: true }))
          await page.locator(UNDO_TOAST).getByRole('button', { name: 'Undo' }).click()
          await page.waitForSelector(UNDO_TOAST, { state: 'detached' })
          await page.waitForSelector('[role="row"][data-row-index="0"]')
          palette.push(await measure(page, { kind: 'key', key: 'k', ctrl: true }, { ready: '[role="dialog"][aria-label="Command palette"]', anim: true }))
          await closeDialog(page)
        }
        addTimings(spec, 'Add column panel', records, cpu, addColumn, fields)
        addTimings(spec, 'Row ⋯ → Move to the Trash', records, cpu, trash, fields)
        addTimings(spec, 'Ctrl+K palette', records, cpu, palette, fields)

        // A record's page: Print or save ▾ → Save as PDF…
        await page.locator('[role="row"][data-row-index="0"] [role="gridcell"][aria-colindex="2"] button').click()
        await page.waitForSelector('main h1')
        await waitQuiet(page, 500)
        for (let i = 0; i < RUNS; i++) {
          await page.getByRole('button', { name: /print or save/i }).first().click()
          await page.waitForSelector('[role="menu"]')
          pdf.push(await measure(page, { kind: 'click', selector: '[role="menuitem"]', text: 'Save as PDF' }, { ready: DIALOG, anim: true }))
          await closeDialog(page)
        }
        addTimings(spec, 'Record page → Save as PDF…', records, cpu, pdf, fields)

        // Settings → Data → Delete all history…
        await page.evaluate(() => { window.location.hash = '#/settings?tab=data' })
        await page.getByRole('button', { name: /delete all history/i }).waitFor({ timeout: 10000 })
        await waitQuiet(page, 500)
        for (let i = 0; i < RUNS; i++) {
          settings.push(await measure(page, { kind: 'click', selector: 'button', text: 'Delete all history' }, { ready: DIALOG, anim: true }))
          await closeDialog(page)
        }
        addTimings(spec, 'Settings → Delete all history…', records, cpu, settings, fields)
      })
      report(spec)
    })

    test('command palette and list search', async () => {
      const spec = 'Palette and search'
      ctx = await openSeeded(seeded)
      const page = ctx.window
      await atEachCpu(page, async cpu => {
        const perKey: Array<number | null> = [], perKeyPainted: Array<number | null> = [], other: Array<number | null> = [], settled: Array<number | null> = []
        const errors = new Set<string>()
        for (let i = 0; i < 5; i++) {
          await page.keyboard.press('Control+k')
          await page.waitForSelector('[cmdk-input]')
          await waitQuiet(page, 400)
          const r = await typeAndTime(page, { input: '[cmdk-input]', text: 'mar', watch: '[cmdk-list]', waitFor: '[cmdk-group-heading]', waitForText: 'other' })
          if (r.error) errors.add(r.error)
          perKey.push(...r.perKey); perKeyPainted.push(...r.perKeyPainted); other.push(r.waitFor); settled.push(r.settled)
          await closeDialog(page)
        }
        const note = errors.size ? [...errors].join('; ') : undefined
        add(spec, "Palette 'mar': key → results changed", records, cpu, perKey, 'ms', note)
        add(spec, "Palette 'mar': key → painted", records, cpu, perKeyPainted)
        add(spec, "Palette 'mar': last key → Other lists group", records, cpu, other, 'ms', 'includes the 200 ms pause before searching other lists')
        add(spec, "Palette 'mar': last key → settled", records, cpu, settled)

        const search: Array<number | null> = [], afterDebounce: Array<number | null> = []
        const searchErrors = new Set<string>()
        const box = page.getByRole('searchbox').or(page.locator('input[aria-label^="Search"]')).first()
        for (let i = 0; i < 5; i++) {
          await waitQuiet(page, 400)
          const r = await typeAndTime(page, { input: 'input[aria-label^="Search"]', text: 'gar', watch: '[role="grid"]' })
          if (r.error) searchErrors.add(r.error)
          search.push(r.settled); afterDebounce.push(r.settled == null ? null : r.settled - 150)
          await box.fill('')
          await page.waitForSelector(ROWS)
        }
        const searchNote = searchErrors.size ? [...searchErrors].join('; ') : undefined
        add(spec, "List search 'gar': last key → rows settled", records, cpu, search, 'ms', searchNote ?? 'includes the 150 ms debounce')
        add(spec, "List search 'gar': after the 150 ms debounce", records, cpu, afterDebounce)
      })
      report(spec)
    })

    test('list scrolling, with motion on and reduced', async () => {
      const spec = 'Scroll'
      for (const motion of ['on', 'reduced'] as const) {
        if (motion === 'reduced') {
          // The in-app setting (needs a relaunch to load) and the system preference, which stops the pulsing cells
          ctx = await openSeeded(seeded)
          await ipc(ctx.window, 'settings:update', 'reduced_motion', 'true')
          await closeApp(ctx)
        }
        ctx = await openSeeded(seeded)
        const page = ctx.window
        if (motion === 'reduced') await page.emulateMedia({ reducedMotion: 'reduce' })
        const pulsing = await page.evaluate(() => document.querySelectorAll('.alert-pulse, .alert-pulse-dark').length)
        await atEachCpu(page, async cpu => {
          const runs = []
          for (let i = 0; i < 3; i++) {
            await waitQuiet(page, 400)
            runs.push(await frameSampler(page, 2500, 2000))
          }
          const note = `motion ${motion}; ${pulsing} pulsing cells on screen; 2.5k px/s for 2 s`
          add(spec, `frame p50 (motion ${motion})`, records, cpu, runs.map(r => r.p50), 'ms', note)
          add(spec, `frame p95 (motion ${motion})`, records, cpu, runs.map(r => r.p95))
          add(spec, `longest frame (motion ${motion})`, records, cpu, runs.map(r => r.max))
          add(spec, `frames over 16.7 ms (motion ${motion})`, records, cpu, runs.map(r => r.over16), '%')
          add(spec, `frames over 25 ms (motion ${motion})`, records, cpu, runs.map(r => r.over25), '%')
        })
        if (motion === 'reduced') await ipc(page, 'settings:update', 'reduced_motion', 'false')
        await closeApp(ctx)
        ctx = undefined
      }
      report(spec)
    })

    test('first visit of the lazily loaded views', async () => {
      const spec = 'Lazy views'
      ctx = await openSeeded(seeded)
      const page = ctx.window
      for (const [hash, name] of [['#/calendar', 'Calendar'], ['#/reports', 'Reports'], ['#/help', 'Help']] as const) {
        const r = await measure(page, { kind: 'hash', hash }, { ready: '#main-content', readyAny: true, watchFallback: true, quietMs: 400 })
        add(spec, `${name}: "Loading…" shown for`, records, 1, [r.fallbackMs], 'ms', r.error)
        add(spec, `${name}: settled`, records, 1, [r.settled])
        await page.evaluate(() => { window.location.hash = '#/grid' })
        await page.waitForSelector(ROWS)
        await waitQuiet(page, 500)
      }
      report(spec)
    })
  })
}
