/**
 * Saved window size and position: what to store, and what's safe to restore.
 * Pure functions so they can be tested without Electron.
 */

export interface Rect { x: number; y: number; width: number; height: number }

export interface SavedWindowState {
  width: number
  height: number
  x?: number
  y?: number
  maximized: boolean
}

/** How much of the title bar must be on a screen for the window to be reachable */
const MIN_VISIBLE = 100

function overlaps(a: Rect, b: Rect): { w: number; h: number } {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
  return { w, h }
}

/**
 * The state to save. A maximized window's bounds are the whole screen, so the
 * normal (un-maximized) bounds are saved instead: un-maximizing next time then
 * goes back to a real size.
 */
export function windowStateToSave(normalBounds: Rect, maximized: boolean): SavedWindowState {
  const { x, y, width, height } = normalBounds
  return { width, height, x, y, maximized }
}

/**
 * The saved state, with the position dropped when it's no longer on a
 * connected screen (a laptop last used with an external monitor), so the
 * window opens centred instead of off-screen.
 */
export function restorableWindowState(saved: SavedWindowState, workAreas: Rect[]): SavedWindowState {
  const { x, y } = saved
  if (x === undefined || y === undefined || !Number.isFinite(x) || !Number.isFinite(y)) {
    return { width: saved.width, height: saved.height, maximized: saved.maximized }
  }
  // The top strip (title bar) must be visible enough to grab
  const titleBar: Rect = { x, y, width: saved.width, height: Math.min(saved.height, 40) }
  const reachable = workAreas.some(area => {
    const { w, h } = overlaps(titleBar, area)
    return w >= Math.min(MIN_VISIBLE, saved.width) && h > 0
  })
  if (reachable) return saved
  return { width: saved.width, height: saved.height, maximized: saved.maximized }
}

/**
 * The window's colour before the page paints (Q8). The saved theme is inside
 * the locked database when the window opens, so the computer's own setting is
 * the best guess, and it's also Pulse's default (follow the computer). With a
 * fixed light colour a dark-mode user got a light flash on every launch.
 */
export function windowBackground(dark: boolean): string {
  return dark ? '#0F172A' : '#F8FAFC' // slate-900 / slate-50, the app's own backgrounds
}
