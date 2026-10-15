/**
 * The second click of a double-click is ignored on things that act on one click.
 *
 * Many people double-click everything. Before this, a double-click on Add made two
 * records, on a ⋯ button or Done opened a menu or dialog and shut it again at once,
 * and on a checkbox ticked and unticked it (2026-10 persona study, Joe). One
 * capture-phase listener on the document drops a click whose `detail` is 2 or more
 * before React sees it, on buttons, menu items, options, checkboxes, radios, links
 * and dialog backdrops (`data-dialog-backdrop`, on the backdrop element itself).
 *
 * - The `dblclick` event still fires, so double-click to rename a column header or
 *   to edit a cell keeps working.
 * - Keyboard activation (Enter, Space) sends clicks with `detail` 0, never touched.
 * - Text boxes, text areas, selects and editable text aren't matched, so a
 *   double-click still selects a word.
 * - `data-allow-repeat` on a control or an ancestor opts out: steppers and arrows
 *   meant to be clicked fast (move up/down, previous/next, undo/redo).
 */
import { useEffect } from 'react'

const GUARDED = [
  'button',
  '[role="button"]',
  '[role="menuitem"]',
  '[role="menuitemcheckbox"]',
  '[role="menuitemradio"]',
  '[role="option"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="switch"]',
  '[role="tab"]',
  'input[type="checkbox"]',
  'input[type="radio"]',
  'input[type="button"]',
  'input[type="submit"]',
  'input[type="reset"]',
  'a[href]',
  'summary',
].join(', ')

const BUTTON_INPUTS = new Set(['checkbox', 'radio', 'button', 'submit', 'reset', 'image'])

/** A place where a double-click selects a word, which must keep working */
function isTextEntry(el: Element): boolean {
  if (el instanceof HTMLInputElement) return !BUTTON_INPUTS.has(el.type)
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true
  return el instanceof HTMLElement && el.isContentEditable
}

/** True when a repeated click (detail ≥ 2) on this target should be dropped */
export function isRepeatClickGuarded(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  if (target.closest('[data-allow-repeat]')) return false
  // Only the backdrop itself: a click inside the panel it holds isn't a click outside
  if (target.hasAttribute('data-dialog-backdrop')) return true
  if (isTextEntry(target)) return false
  if (target.closest(GUARDED)) return true
  // A label that ticks a checkbox or radio passes its click on to it
  const control = target.closest('label')?.control
  return control instanceof HTMLInputElement && (control.type === 'checkbox' || control.type === 'radio')
}

function onClickCapture(e: MouseEvent): void {
  if (e.detail < 2 || !isRepeatClickGuarded(e.target)) return
  e.preventDefault()
  e.stopPropagation()
}

/**
 * The second press doesn't move focus either: the menu or dialog the first click opened
 * keeps it, so the arrow keys and Escape still work there. Other mousedown listeners
 * still hear it (a click outside a pop-up still counts).
 */
function onMouseDownCapture(e: MouseEvent): void {
  if (e.detail < 2 || e.button !== 0 || !isRepeatClickGuarded(e.target)) return
  e.preventDefault()
}

/** Mount once, at the app's root */
export function useRepeatClickGuard(): void {
  useEffect(() => {
    document.addEventListener('click', onClickCapture, true)
    document.addEventListener('mousedown', onMouseDownCapture, true)
    return () => {
      document.removeEventListener('click', onClickCapture, true)
      document.removeEventListener('mousedown', onMouseDownCapture, true)
    }
  }, [])
}
