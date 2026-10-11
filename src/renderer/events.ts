// Typed event bus — replaces raw window.dispatchEvent(new CustomEvent(...))
// All renderer-side custom events go through this singleton.

type PulseEvents = {
  'checklist:changed': { rowId: number }
  'linkedproviders:changed': { rowId: number }
  'deadline:changed': undefined
  'followup:changed': undefined
  'urgentchecklist:changed': undefined
  'toggle-find-replace': undefined
  'sample-data:changed': undefined
  /** Records were archived or reactivated (Undo and Redo included), so what's due changed */
  'records:archive-changed': undefined
  'contact-req:changed': undefined
  'note-tracking:changed': undefined
  /** Open a form to fill in (W08): a new record, or this one */
  'form:fill': { formId: number; gridId: number; rowId?: number }
  /** The app is about to lock: save anything pending while the database is still open */
  'app:locking': undefined
  /** A cell was saved with a new value (not by undo) */
  'cell:changed': { rowId: number; columnId: number; from: string | null; to: string | null }
  /** Open a column's deadline rule picker (from a "Choose a rule" cell) */
  'column:choose-rule': { columnId: number }
  /** Change a column's width from its menu, for keyboard users (AUDIT-150) */
  'column:resize': { columnId: number; change: 'wider' | 'narrower' | 'fit' }
  /** Open the spreadsheet import for the open list */
  'grid:open-import': undefined
  /** Open "Add column" for the open list (from the empty list screen) */
  'grid:add-column': undefined
  /** Open the example gallery (adding to this workspace), optionally with sample data ticked */
  'starters:open': { sample: boolean }
  /** Open the command palette (Ctrl+F on a screen without its own search) */
  'palette:open': undefined
  /** Open What's New (from Help or Settings → About) */
  'whats-new:open': undefined
  /** The calendar day changed while the app was open: days-until and "due today" need working out again */
  'day:changed': { date: string }
  /** Show first-run setup again (no lists left), at one of its starting points */
  'setup:open': { step: 'start' | 'examples' | 'sheet-name' | 'blank' }
}

class TypedEventBus {
  private emitter = new EventTarget()

  emit<K extends keyof PulseEvents>(
    ...args: PulseEvents[K] extends undefined
      ? [event: K]
      : [event: K, data: PulseEvents[K]]
  ): void {
    const [event, data] = args
    this.emitter.dispatchEvent(new CustomEvent(event, { detail: data }))
  }

  on<K extends keyof PulseEvents>(
    event: K,
    handler: (data: PulseEvents[K]) => void,
  ): () => void {
    const listener = (e: Event) => handler((e as CustomEvent).detail)
    this.emitter.addEventListener(event, listener)
    return () => this.emitter.removeEventListener(event, listener)
  }
}

export const pulseEvents = new TypedEventBus()
