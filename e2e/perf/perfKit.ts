/**
 * Real-app timing kit for the speed work (plan-Q9 Q9a.2). Used by
 * e2e/perf/speed.spec.ts; skips unless PULSE_PERF=1, so `npm run test:e2e`
 * doesn't run it.
 *
 * Run (needs a build; on this machine X11, not Wayland):
 *   env -u WAYLAND_DISPLAY XDG_SESSION_TYPE=x11 npm run perf:e2e
 * Options:
 *   PULSE_PERF_RECORDS=600,5000   record counts to seed (default 600)
 *   PULSE_PERF_CPU=1,4            CPU slow-down rates for the scroll pass (default 1,4)
 *   PERF_OUT_DIR=<folder>         also write e2e.json there
 *
 * Every timing is taken inside the page on one clock: the action (a click, a
 * key, a route change) is started in-page with performance.now() as t0, and a
 * MutationObserver notes when the thing we wait for appears and when the page
 * stops changing. No app code is instrumented.
 */
import { test, _electron, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { launchApp, setupPassword, skipOnboarding, unlockApp, cleanup, type AppContext } from '../helpers'

export { cleanup, type AppContext }

export const PERF = process.env.PULSE_PERF === '1'
export const PASSWORD = 'PerfPassword123!'
export const RECORD_COUNTS = (process.env.PULSE_PERF_RECORDS ?? '600').split(',').map(s => Number(s.trim())).filter(n => n > 0)
export const CPU_RATES = (process.env.PULSE_PERF_CPU ?? '1,4').split(',').map(s => Number(s.trim())).filter(n => n >= 1)
const OUT_DIR = process.env.PERF_OUT_DIR

export function skipUnlessPerf(): void {
  test.skip(!PERF, 'Speed measurements only run with PULSE_PERF=1 (npm run perf:e2e)')
  test.describe.configure({ timeout: 30 * 60_000 })
}

// ── App lifecycle ────────────────────────────────────────────────────────────

/** 1366×768: a common laptop screen, what most of the people Pulse is for have */
export async function sizeWindow(ctx: AppContext, w = 1366, h = 768): Promise<void> {
  await ctx.electronApp.evaluate(({ BrowserWindow }, [cw, ch]) => {
    const win = BrowserWindow.getAllWindows()[0]
    win?.unmaximize()
    win?.setContentSize(cw as number, ch as number)
    // A window behind others (or not focused) gets its frames throttled by Chromium,
    // which would time the throttling, not Pulse
    win?.webContents.setBackgroundThrottling(false)
    win?.show()
    win?.moveTop()
    win?.focus()
  }, [w, h])
  await ctx.window.waitForTimeout(300)
}

/** Call an IPC channel from the renderer, the way the app does. Throws on a failed result. */
export async function ipc<T = unknown>(page: Page, channel: string, ...args: unknown[]): Promise<T> {
  return page.evaluate(async ({ ch, a }) => {
    const api = (window as unknown as { api: { invoke: (c: string, ...x: unknown[]) => Promise<{ ok: boolean; data: unknown; error?: string }> } }).api
    const r = await api.invoke(ch, ...a)
    if (!r.ok) throw new Error(`${ch}: ${r.error}`)
    return r.data as T
  }, { ch: channel, a: args })
}

export interface Seeded {
  dataDir: string
  /** Records asked for (the example's own sample records come on top: see `total`) */
  records: number
  total: number
  columns: number
  gridId: number
  otherGridId: number
}

/**
 * A new install with `n` records: password, the Human services example, then
 * one list with 20+ columns (two rule date columns, dropdown, phone, text…),
 * about a quarter of the records overdue so pulsing cells are on screen, a
 * second list (so the palette has other lists to search), and notes,
 * checklist items and tasks on the first 10 records. Records go in through
 * the CSV import, in one call. Returns the closed app's data folder.
 */
export async function seedWorkspace(n: number): Promise<Seeded> {
  const ctx = await launchApp()
  try {
    await sizeWindow(ctx)
    await setupPassword(ctx.window, PASSWORD)
    await skipOnboarding(ctx.window)
    await ctx.window.waitForSelector('nav, [class*="sidebar"]', { timeout: 20000 })
    const page = ctx.window
    await ipc(page, 'settings:update', 'onboarding_recovery_snooze_until', '2099-12-31').catch(() => {})

    const plan = await page.evaluate(async () => {
      const api = (window as unknown as { api: { invoke: (c: string, ...a: unknown[]) => Promise<{ ok: boolean; data: unknown; error?: string }> } }).api
      const inv = async <T,>(ch: string, ...args: unknown[]): Promise<T> => {
        const r = await api.invoke(ch, ...args)
        if (!r.ok) throw new Error(`${ch}: ${r.error}`)
        return r.data as T
      }
      interface Col { id: number; name: string; column_type: string; is_name_column: number; config: string }
      const grids = await inv<Array<{ id: number }>>('grid:get-all')
      const gridId = grids[0]!.id
      const full = await inv<{ columns: Col[] }>('grid:get-full', gridId)
      const thresholds = (soon: number) => JSON.stringify([
        { daysBefore: soon, bgClass: '#facc15', label: 'Due Soon' },
        { daysBefore: 7, bgClass: '#fb923c', label: 'Urgent' },
        { daysBefore: 0, bgClass: '#dc2626', label: 'Due Today' },
        { daysBefore: -1, bgClass: 'alert-pulse-dark', label: 'Overdue' },
      ])
      const monthly = await inv<number>('alert-rule:create', { name: 'Perf monthly contact', description: null, is_system: 0, interval_days: 30, thresholds: thresholds(14) })
      const annual = await inv<number>('alert-rule:create', { name: 'Perf annual review', description: null, is_system: 0, interval_days: 365, thresholds: thresholds(30) })
      // Reuse the example's columns by name (names are unique per list), add the rest
      const col = async (name: string, type: string, config?: string): Promise<number> => {
        const hit = full.columns.find(c => c.name.toLowerCase() === name.toLowerCase())
        const id = hit ? Number(hit.id) : Number(await inv<number>('column:create', gridId, name, type))
        if (config) await inv('column:update', id, { config })
        return id
      }
      const nameCol = (full.columns.find(c => c.is_name_column) ?? full.columns[0]!).id
      const cols: Array<{ id: number; name: string; kind: string }> = [{ id: nameCol, name: 'Name', kind: 'name' }]
      cols.push({ id: await col('Last Contact', 'date', JSON.stringify({ alert_rule_id: Number(monthly) })), name: 'Last Contact', kind: 'monthly' })
      cols.push({ id: await col('Annual Review', 'date', JSON.stringify({ alert_rule_id: Number(annual) })), name: 'Annual Review', kind: 'annual' })
      cols.push({ id: await col('Program', 'dropdown', JSON.stringify({ options: ['Waiver', 'Case Management', 'Housing', 'Behavioral Health'] })), name: 'Program', kind: 'program' })
      cols.push({ id: await col('Phone', 'phone'), name: 'Phone', kind: 'phone' })
      cols.push({ id: await col('Date of Birth', 'date'), name: 'Date of Birth', kind: 'dob' })
      cols.push({ id: await col('Email', 'email'), name: 'Email', kind: 'email' })
      cols.push({ id: await col('Units authorized', 'number'), name: 'Units authorized', kind: 'number' })
      cols.push({ id: await col('Consent signed', 'checkbox'), name: 'Consent signed', kind: 'checkbox' })
      for (let i = 1; i <= 14; i++) cols.push({ id: await col(`Perf field ${i}`, 'text'), name: `Perf field ${i}`, kind: 'text' })

      // A second list, so the palette's "Other lists" group has something to find
      const otherGridId = Number(await inv<number>('grid:create', 'Waitlist'))
      const otherFull = await inv<{ columns: Col[] }>('grid:get-full', otherGridId)
      const otherName = (otherFull.columns.find(c => c.is_name_column) ?? otherFull.columns[0])
      if (otherName) {
        for (let i = 0; i < 40; i++) {
          const rowId = Number(await inv<number>('row:create', otherGridId))
          // Names that sort first: the cross-list search returns the first 20 matches by name across all
          // lists, open list included, so at 5,000 records the open list's "Aisha Martin"s fill all 20
          await inv('cell:update', rowId, otherName.id, `${['Aamari', 'Aamari', 'Aamari', 'Aagaard'][i % 4]} Waitlist ${i + 1}`)
        }
      }
      return { gridId, otherGridId, cols }
    })

    // The CSV: deterministic, ~25 % of "Last Contact" dates past the 30-day rule (overdue)
    const first = ['Maria', 'James', 'Aisha', 'Robert', 'Linh', 'Dorothy', 'Carlos', 'Priya', 'Frank', 'Keisha', 'Marcus', 'Gary']
    const last = ['Garcia', 'Johnson', 'Okafor', 'Smith', 'Nguyen', 'Walker', 'Rivera', 'Patel', 'Miller', 'Brown', 'Garner', 'Martin']
    const programs = ['Waiver', 'Case Management', 'Housing', 'Behavioral Health']
    const day = (offset: number) => {
      const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() + offset)
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    }
    let s = 11
    const rand = (k: number) => { s = (s * 16807) % 2147483647; return s % k }
    const quote = (v: string) => /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
    const lines = [plan.cols.map(c => quote(c.name)).join(',')]
    for (let i = 0; i < n; i++) {
      lines.push(plan.cols.map(c => {
        switch (c.kind) {
          case 'name': return `${first[i % first.length]} ${last[Math.floor(i / first.length) % last.length]} ${i + 1}`
          case 'monthly': return day(i % 4 === 0 ? -(35 + rand(40)) : -rand(25))
          case 'annual': return day(-rand(380))
          case 'program': return programs[rand(4)]!
          case 'phone': return `(555) ${String(100 + rand(900))}-${String(1000 + rand(9000))}`
          case 'dob': return day(-(365 * (25 + rand(50))))
          case 'email': return `person${i + 1}@example.org`
          case 'number': return String(10 + rand(200))
          case 'checkbox': return i % 3 ? 'true' : 'false'
          default: return `Detail ${rand(1000)}`
        }
      }).map(quote).join(','))
    }
    const csvDir = join(ctx.dataDir, 'perf-seed')
    mkdirSync(csvDir, { recursive: true })
    const csvPath = join(csvDir, `perf-${n}.csv`)
    writeFileSync(csvPath, lines.join('\n') + '\n', 'utf-8')
    await ipc(page, 'import:file', {
      gridId: plan.gridId, filePath: csvPath, headerRowIndex: 0, duplicateStrategy: 'none', cleanData: false,
      columnMappings: plan.cols.map((c, i) => ({ sourceIndex: i, action: c.id })),
    })

    // Notes, checklist items and tasks on the first 10 records
    await page.evaluate(async ({ gridId }) => {
      const api = (window as unknown as { api: { invoke: (c: string, ...a: unknown[]) => Promise<{ ok: boolean; data: unknown; error?: string }> } }).api
      const inv = async <T,>(ch: string, ...args: unknown[]): Promise<T> => {
        const r = await api.invoke(ch, ...args)
        if (!r.ok) throw new Error(`${ch}: ${r.error}`)
        return r.data as T
      }
      const day = (offset: number) => {
        const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() + offset)
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      }
      const full = await inv<{ rows: Array<{ row_id: number }> }>('grid:get-full', gridId)
      for (const { row_id: rowId } of full.rows.slice(0, 10)) {
        await inv('case-log:create', rowId, 'Home visit completed. Doing well; discussed the housing application timeline.', 'note', null)
        await inv('case-log:create', rowId, 'Called the provider about therapy intake — waiting on a callback.', 'phone', day(3))
        await inv('case-log:create', rowId, 'Annual review packet sent to the supervisor.', 'note', day(-2))
        for (const [title, due] of [['Submit monthly billing', 0], ['Update service plan', 5], ['Renew background check', 20]] as const) {
          await inv('checklist:create-item', rowId, title, { due_date: day(due) })
        }
      }
      for (const [title, due, priority] of [['Monthly caseload report', 2, 'high'], ['Call county about waiver slots', 0, 'normal'], ['Quarterly audit prep', -3, 'high']] as const) {
        await inv('task:create', {
          grid_id: null, group_id: null, title, description: null, priority, category: null, due_date: day(due),
          recurrence_rule: null, is_completed: 0, completed_at: null, snoozed_until: null, position: 0,
        })
      }
    }, { gridId: plan.gridId })

    const rows = (await ipc<{ rows: unknown[] }>(page, 'grid:get-full', plan.gridId)).rows.length
    if (rows < n) throw new Error(`Seeding imported ${rows} records, expected ${n}`)
    return { dataDir: ctx.dataDir, records: n, total: rows, columns: plan.cols.length, gridId: plan.gridId, otherGridId: plan.otherGridId }
  } finally {
    await ctx.electronApp.close().catch(() => {})
  }
}

/**
 * Like helpers' launchApp, plus the Chromium switches that keep a window drawing
 * at full rate while it's behind other windows or not focused. Without them, a
 * run on a desktop in use gets one frame a second and times the throttling.
 */
async function launchAwake(dataDir: string): Promise<AppContext> {
  const electronApp = await _electron.launch({
    args: [
      join(__dirname, '..', '..', 'out', 'main', 'index.js'), `--user-data-dir=${join(dataDir, 'electron')}`,
      '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--disable-background-timer-throttling',
      // Frames from a timer, not the screen: a desktop whose screen is off or covered hands out
      // one frame a second (XWayland). A frame interval is then how long the page needs per frame.
      '--disable-gpu-vsync', '--disable-frame-rate-limit',
    ],
    env: { ...process.env, PULSE_DATA_DIR: dataDir, NODE_ENV: 'test' },
  })
  const window = await electronApp.firstWindow()
  await window.waitForLoadState('domcontentloaded')
  return { electronApp, window, dataDir }
}

/** Idle frame interval (median of ~30 frames) and whether the page thinks it's visible */
export async function frameCheck(page: Page): Promise<{ frameMs: number; visibility: string }> {
  return page.evaluate(() => new Promise<{ frameMs: number; visibility: string }>(resolve => {
    const deltas: number[] = []
    let prev = 0
    const step = (now: number) => {
      if (prev) deltas.push(now - prev)
      prev = now
      if (deltas.length < 30) requestAnimationFrame(step)
      else resolve({ frameMs: Math.round(10 * [...deltas].sort((a, b) => a - b)[15]!) / 10, visibility: document.visibilityState })
    }
    requestAnimationFrame(step)
    // A page that gets no frames at all still answers
    setTimeout(() => resolve({ frameMs: deltas.length ? Math.round(10 * [...deltas].sort((a, b) => a - b)[Math.floor(deltas.length / 2)]!) / 10 : Infinity, visibility: document.visibilityState }), 5000)
  }))
}

/** Relaunch on a seeded data folder and unlock, so everything loads cold; returns on the list */
export async function openSeeded(seeded: Seeded): Promise<AppContext> {
  const ctx = await launchAwake(seeded.dataDir)
  await sizeWindow(ctx)
  await unlockApp(ctx.window, PASSWORD)
  await ctx.window.waitForSelector('[role="grid"] [role="row"][data-row-index]', { timeout: 60000 })
  await ctx.window.mouse.move(1360, 760)
  await waitQuiet(ctx.window, 1000)
  const check = await frameCheck(ctx.window)
  add('Sanity', `idle frame interval at launch (page ${check.visibility})`, seeded.records, 1, [Number.isFinite(check.frameMs) ? check.frameMs : null])
  if (check.frameMs > 20 || check.visibility !== 'visible') {
    console.log(`[perf:e2e] WARNING: the window draws a frame every ${check.frameMs} ms (${check.visibility}); timings that wait for a frame are not trustworthy`)
  }
  return ctx
}

/** Close the app but keep the seeded data folder for the next test */
export async function closeApp(ctx: AppContext): Promise<void> {
  try { await ctx.electronApp.close() } catch { /* already closed */ }
}

// ── CPU slow-down ────────────────────────────────────────────────────────────

/** Chrome's CPU throttling (4 = "an old laptop"). False when the CDP session isn't available. */
export async function throttleCpu(page: Page, rate: number): Promise<boolean> {
  try {
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Emulation.setCPUThrottlingRate', { rate })
    return true
  } catch (err) {
    console.log(`[perf] CPU throttling not available (${(err as Error).message.split('\n')[0]}); running at 1×`)
    return false
  }
}

// ── In-page timing ───────────────────────────────────────────────────────────

/** What starts the clock, run inside the page */
export type Action =
  | { kind: 'click'; selector: string; text?: string }
  | { kind: 'key'; key: string; ctrl?: boolean; shift?: boolean }
  | { kind: 'back' }
  | { kind: 'hash'; hash: string }

export interface MeasureOptions {
  /** Selector of what we wait for; only an element that wasn't there before the action counts */
  ready: string
  /** Let an element that was already there count as ready (then only "settled" means much) */
  readyAny?: boolean
  /** Quiet window that ends "settled" (not counted) */
  quietMs?: number
  timeoutMs?: number
  /** Also wait for the ready element's animations (opacity/transform stable, no finite animation running) */
  anim?: boolean
  /** Note when a "Loading…" fallback shows and goes */
  watchFallback?: boolean
}

export interface Timing {
  /** Ready element in the DOM */
  ready: number | null
  /** The frame after ready was painted (rAF, then a task) */
  painted: number | null
  /** Its animations done (anim only) */
  animDone: number | null
  /** Last DOM change before the quiet window */
  settled: number | null
  /** "Loading…" fallback shown for this long (watchFallback only; 0 = never shown) */
  fallbackMs: number | null
  /** What changed last (tag.class[attribute]), to find what keeps a page from settling */
  lastChangeOn?: string
  error?: string
}

/** Wait until the DOM has been still for `quietMs` (bounded), ignoring live regions and toasts */
export async function waitQuiet(page: Page, quietMs = 500, timeoutMs = 10000): Promise<void> {
  await page.evaluate(({ quietMs, timeoutMs }) => new Promise<void>(resolve => {
    const ignored = (n: Node | null): boolean => {
      const el = n instanceof Element ? n : n?.parentElement ?? null
      return !!el?.closest('[aria-live], [role="status"], [role="timer"], [role="tooltip"]')
    }
    let last = performance.now()
    const mo = new MutationObserver(list => { if (list.some(m => !ignored(m.target))) last = performance.now() })
    mo.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true })
    const start = performance.now()
    const tick = () => {
      const now = performance.now()
      if (now - last >= quietMs || now - start > timeoutMs) { mo.disconnect(); resolve(); return }
      setTimeout(tick, 50)
    }
    tick()
  }), { quietMs, timeoutMs })
}

/**
 * Run `action` in the page and time it: when `opts.ready` appears (a new
 * element only), when that frame was painted, when its animations finished,
 * and when the page stopped changing. All times are ms from the action.
 */
export async function measure(page: Page, action: Action, opts: MeasureOptions): Promise<Timing> {
  return page.evaluate(({ action, ready, readyAny, quietMs, timeoutMs, anim, watchFallback }) => new Promise<Timing>(resolve => {
    const visible = (el: Element) => (el as HTMLElement).getClientRects().length > 0
    const label = (el: Element) => `${el.textContent ?? ''} ${el.getAttribute('aria-label') ?? ''}`.toLowerCase()
    const find = (selector: string, text?: string): HTMLElement | null => {
      const all = [...document.querySelectorAll<HTMLElement>(selector)].filter(visible)
      return (text ? all.find(el => label(el).includes(text.toLowerCase())) : all[0]) ?? null
    }
    const ignored = (n: Node | null): boolean => {
      const el = n instanceof Element ? n : n?.parentElement ?? null
      return !!el?.closest('[aria-live], [role="status"], [role="timer"], [role="tooltip"]')
    }
    const isFallback = (el: Element) => el.textContent?.trim() === 'Loading…' && el.children.length === 0 && !el.closest('main')

    const before = new Set<Element>(readyAny ? [] : [...document.querySelectorAll(ready)])
    const out: Timing = { ready: null, painted: null, animDone: null, settled: null, fallbackMs: watchFallback ? 0 : null }
    let t0 = 0
    let lastChange = 0
    let readyEl: Element | null = null
    let fallbackAt: number | null = null
    let done = false

    const finish = (error?: string) => {
      if (done) return
      done = true
      mo.disconnect()
      if (error) out.error = error
      // A dialog without an animation is "done" when it's on screen
      if (out.animDone != null && out.painted != null && out.animDone < out.painted) out.animDone = out.painted
      resolve(out)
    }
    const checkReady = () => {
      if (readyEl) return
      const hit = [...document.querySelectorAll(ready)].find(el => !before.has(el) && visible(el) && (el as HTMLElement).getBoundingClientRect().height > 0)
      if (!hit) return
      readyEl = hit
      out.ready = performance.now() - t0
      requestAnimationFrame(() => setTimeout(() => { out.painted = performance.now() - t0 }, 0))
      if (anim) watchAnimations(hit)
    }
    const watchAnimations = (el: Element) => {
      const sig = () => [el, el.parentElement, el.firstElementChild].map(e => {
        if (!e) return ''
        const cs = getComputedStyle(e)
        return `${cs.opacity}|${cs.transform}`
      }).join(';')
      let prev = sig()
      let prevAt = performance.now()
      const frame = () => {
        if (done) return
        const running = document.getAnimations().filter(a => a.playState === 'running' && a.effect?.getTiming().iterations !== Infinity)
        const now = sig()
        if (running.length === 0 && now === prev) { out.animDone = prevAt - t0; return }
        if (now !== prev) { prev = now; prevAt = performance.now() }
        if (performance.now() - t0 > timeoutMs) return
        requestAnimationFrame(frame)
      }
      requestAnimationFrame(frame)
    }

    const describe = (m: MutationRecord) => {
      const el = m.target instanceof Element ? m.target : m.target.parentElement
      if (!el) return m.type
      const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/).slice(0, 3).join('.') : ''
      return `${el.tagName.toLowerCase()}${cls ? `.${cls}` : ''}${m.type === 'attributes' ? `[${m.attributeName}]` : m.type === 'childList' ? '(children)' : '(text)'}`
    }
    const mo = new MutationObserver(list => {
      const now = performance.now()
      const counted = list.filter(m => !ignored(m.target))
      if (counted.length) { lastChange = now; out.lastChangeOn = describe(counted[counted.length - 1]!) }
      if (watchFallback) {
        for (const m of list) {
          for (const n of m.addedNodes) {
            if (fallbackAt == null && n instanceof Element && (isFallback(n) || [...n.querySelectorAll('div')].some(isFallback))) fallbackAt = now
          }
          for (const n of m.removedNodes) {
            if (fallbackAt != null && n instanceof Element && (isFallback(n) || [...n.querySelectorAll('div')].some(isFallback))) {
              out.fallbackMs = (out.fallbackMs ?? 0) + now - fallbackAt
              fallbackAt = null
            }
          }
        }
      }
      checkReady()
    })

    // Find the target first, so the search isn't timed
    let target: HTMLElement | null = null
    if (action.kind === 'click') {
      target = find(action.selector, action.text)
      if (!target) { resolve({ ...out, error: `not found: ${action.selector}${action.text ? ` "${action.text}"` : ''}` }); return }
    }
    mo.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true })
    t0 = performance.now()
    lastChange = t0
    switch (action.kind) {
      case 'click': {
        // The full press, so handlers on pointer/mouse down or up fire too
        const r = target!.getBoundingClientRect()
        const at = { bubbles: true, cancelable: true, composed: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2, button: 0 }
        target!.dispatchEvent(new PointerEvent('pointerdown', { ...at, pointerId: 1, isPrimary: true }))
        target!.dispatchEvent(new MouseEvent('mousedown', at))
        target!.dispatchEvent(new PointerEvent('pointerup', { ...at, pointerId: 1, isPrimary: true }))
        target!.dispatchEvent(new MouseEvent('mouseup', at))
        target!.click()
        break
      }
      case 'key': {
        const el = document.activeElement ?? document.body
        el.dispatchEvent(new KeyboardEvent('keydown', { key: action.key, code: action.key.length === 1 ? `Key${action.key.toUpperCase()}` : action.key, ctrlKey: !!action.ctrl, metaKey: false, shiftKey: !!action.shift, bubbles: true, cancelable: true }))
        break
      }
      case 'back': history.back(); break
      case 'hash': window.location.hash = action.hash; break
    }
    checkReady()

    const tick = () => {
      if (done) return
      const now = performance.now()
      const animPending = anim && readyEl && out.animDone == null
      if (readyEl && !animPending && now - lastChange >= quietMs && out.painted != null) {
        out.settled = Math.max(lastChange - t0, out.ready ?? 0)
        finish()
        return
      }
      if (now - t0 > timeoutMs) { out.settled = readyEl ? lastChange - t0 : null; finish(readyEl ? 'did not settle' : `timed out waiting for ${ready}`); return }
      setTimeout(tick, 25)
    }
    setTimeout(tick, 25)
  }), {
    action, ready: opts.ready, readyAny: !!opts.readyAny, quietMs: opts.quietMs ?? 300, timeoutMs: opts.timeoutMs ?? 10000,
    anim: !!opts.anim, watchFallback: !!opts.watchFallback,
  })
}

export interface TypingTiming {
  /** Per keystroke: ms from the key to the first change in the watched list */
  perKey: Array<number | null>
  /** Per keystroke: that change painted */
  perKeyPainted: Array<number | null>
  /** From the last key: when `waitFor` appeared (null = never, within the timeout) */
  waitFor: number | null
  /** From the last key: the watched area's last change before a 300 ms quiet window */
  settled: number | null
  error?: string
}

/**
 * Type `text` into `input` one key per `gapMs`, the way a person types: each
 * key sets the value (through React's setter) and fires `input`. Times the
 * first change in `watch` after each key, then `waitFor` and settling after
 * the last key.
 */
export async function typeAndTime(page: Page, opts: { input: string; text: string; watch: string; gapMs?: number; waitFor?: string; waitForText?: string; timeoutMs?: number }): Promise<TypingTiming> {
  return page.evaluate(({ input, text, watch, gapMs, waitFor, waitForText, timeoutMs }) => new Promise<TypingTiming>(resolve => {
    const field = document.querySelector<HTMLInputElement>(input)
    const area = document.querySelector(watch)
    if (!field || !area) { resolve({ perKey: [], perKeyPainted: [], waitFor: null, settled: null, error: `not found: ${field ? watch : input}` }); return }
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    const out: TypingTiming = { perKey: [], perKeyPainted: [], waitFor: null, settled: null }
    let keyAt = 0
    let lastChange = 0
    let awaiting = -1
    let i = 0
    const mo = new MutationObserver(() => {
      const now = performance.now()
      lastChange = now
      if (awaiting >= 0 && out.perKey[awaiting] == null) {
        const k = awaiting
        out.perKey[k] = now - keyAt
        const at = keyAt
        requestAnimationFrame(() => setTimeout(() => { out.perKeyPainted[k] = performance.now() - at }, 0))
      }
      if (waitFor && out.waitFor == null && i >= text.length) {
        const hit = [...document.querySelectorAll(waitFor)].some(el => !waitForText || (el.textContent ?? '').toLowerCase().includes(waitForText.toLowerCase()))
        if (hit) out.waitFor = now - keyAt
      }
    })
    // The list only: React writes the typed value to the input's attribute, which isn't a result
    mo.observe(area, { subtree: true, childList: true, characterData: true, attributes: true })
    field.focus()
    const press = () => {
      out.perKey.push(null); out.perKeyPainted.push(null)
      awaiting = i
      keyAt = performance.now()
      setValue.call(field, text.slice(0, i + 1))
      field.dispatchEvent(new Event('input', { bubbles: true }))
      i++
      if (i < text.length) setTimeout(press, gapMs)
      else setTimeout(wait, 25)
    }
    const wait = () => {
      const now = performance.now()
      const waited = !waitFor || out.waitFor != null
      if (waited && now - Math.max(lastChange, keyAt) >= 300) {
        out.settled = Math.max(0, lastChange - keyAt)
        mo.disconnect(); resolve(out); return
      }
      if (now - keyAt > timeoutMs) {
        out.settled = Math.max(0, lastChange - keyAt)
        mo.disconnect(); resolve({ ...out, error: waited ? 'did not settle' : `never saw ${waitFor}` }); return
      }
      setTimeout(wait, 25)
    }
    press()
  }), { gapMs: 120, timeoutMs: 10000, waitFor: undefined, waitForText: undefined, ...opts })
}

export interface FrameStats { frames: number; p50: number; p95: number; max: number; over16: number; over25: number; scrolledPx: number }

/**
 * Scroll the list body at a constant `pxPerSec` for `ms`, one step per frame,
 * and collect the frame intervals. over16/over25 are percentages of frames.
 */
export async function frameSampler(page: Page, pxPerSec = 2500, ms = 2000): Promise<FrameStats> {
  return page.evaluate(({ pxPerSec, ms }) => new Promise<FrameStats>((resolve, reject) => {
    // The scroll element is the nearest scrolling ancestor of the records' rows (the header has its own rowgroup)
    let el: HTMLElement | null = document.querySelector('[role="grid"] [role="row"][data-row-index]')
    while (el && !(el.scrollHeight > el.clientHeight + 10 && /(auto|scroll)/.test(getComputedStyle(el).overflowY))) el = el.parentElement
    if (!el) { reject(new Error('no scrolling list body found')); return }
    const scroller = el
    scroller.scrollTop = 0
    const deltas: number[] = []
    let start = 0
    let prev = 0
    let y = 0
    const step = (now: number) => {
      if (!start) { start = now; prev = now; requestAnimationFrame(step); return }
      const dt = now - prev
      deltas.push(dt)
      prev = now
      y += pxPerSec * dt / 1000
      // Bounce at the bottom so a short list keeps scrolling for the whole sample
      const max = scroller.scrollHeight - scroller.clientHeight
      const pos = max > 0 ? (Math.floor(y / max) % 2 === 0 ? y % max : max - (y % max)) : 0
      scroller.scrollTop = pos
      if (now - start < ms) requestAnimationFrame(step)
      else {
        const sorted = [...deltas].sort((a, b) => a - b)
        const q = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? 0
        const r1 = (n: number) => Math.round(n * 10) / 10
        resolve({
          frames: deltas.length, p50: r1(q(0.5)), p95: r1(q(0.95)), max: r1(sorted[sorted.length - 1] ?? 0),
          over16: r1(100 * deltas.filter(d => d > 16.7).length / deltas.length), over25: r1(100 * deltas.filter(d => d > 25).length / deltas.length),
          scrolledPx: Math.round(y),
        })
      }
    }
    requestAnimationFrame(step)
  }), { pxPerSec, ms })
}

// ── Results ──────────────────────────────────────────────────────────────────

export interface Row {
  spec: string
  measure: string
  records: number
  cpu: number
  n: number
  median: number | null
  p95: number | null
  min: number | null
  max: number | null
  unit: string
  note?: string
}

const all: Row[] = []
const r1 = (n: number) => Math.round(n * 10) / 10

/** Median/p95/min/max of the samples that came back (nulls are failures, counted in the note) */
export function add(spec: string, measure: string, records: number, cpu: number, samples: Array<number | null>, unit = 'ms', note?: string): Row {
  const ok = samples.filter((v): v is number => typeof v === 'number').sort((a, b) => a - b)
  const failed = samples.length - ok.length
  const q = (p: number) => ok.length ? r1(ok[Math.min(ok.length - 1, Math.floor(p * ok.length))]!) : null
  const row: Row = {
    spec, measure, records, cpu, n: ok.length, unit,
    median: q(0.5), p95: q(0.95), min: ok.length ? r1(ok[0]!) : null, max: ok.length ? r1(ok[ok.length - 1]!) : null,
    ...(note || failed ? { note: [note, failed ? `${failed} of ${samples.length} failed` : ''].filter(Boolean).join('; ') } : {}),
  }
  all.push(row)
  return row
}

export function table(rows: Row[] = all): string {
  return ['| Spec | Measure | Records | CPU | Median | p95 | Min | Max | n | Note |', '|-|-|-|-|-|-|-|-|-|-|',
    ...rows.map(r => `| ${r.spec} | ${r.measure} | ${r.records} | ${r.cpu}× | ${r.median ?? '–'} ${r.unit} | ${r.p95 ?? '–'} | ${r.min ?? '–'} | ${r.max ?? '–'} | ${r.n} | ${r.note ?? ''} |`)].join('\n')
}

/** Print this spec's rows, and write every row so far to PERF_OUT_DIR/e2e.json */
export function report(spec: string): void {
  const mine = all.filter(r => r.spec === spec)
  console.log(`\n[perf:e2e] ${spec}\n${table(mine)}\n`)
  if (OUT_DIR) {
    mkdirSync(OUT_DIR, { recursive: true })
    writeFileSync(join(OUT_DIR, 'e2e.json'), JSON.stringify({ when: new Date().toISOString(), rows: all }, null, 2))
    writeFileSync(join(OUT_DIR, 'e2e.md'), table() + '\n')
  }
}
