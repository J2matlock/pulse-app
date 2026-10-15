/**
 * The "/" snippet menu, shared by the note box and the scratch pad (R2).
 *
 * Drawn on the popover layer in document.body, under the caret (above it when
 * there's no room below), so no card or scroll box clips it. The first match
 * is highlighted as it opens: Enter or Tab inserts it, the arrows pick another,
 * Esc closes, Shift+Enter is still a new line.
 *
 * With snippets on and none made yet, "/" and a letter shows "No snippets yet.
 * Make one…" once per session, which opens the Snippets page.
 */
import React, { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Snippet } from '../../../shared/types'
import { isMod } from '../../utils/keys'
import { matchSnippets } from '../../utils/snippetExpander'
import { LAYER } from '../ui/layers'

/** Where the caret is, in window coordinates */
export interface CaretRect { top: number; bottom: number; left: number }

/** The menu's state in its caller: the matches, the highlighted one, where the caret is */
export interface SnippetMenuState {
  items: Snippet[]
  query: string
  /** No snippets made yet: the one "Make one…" row */
  empty?: boolean
}

const MENU_WIDTH = 288
const GAP = 4
const EDGE = 8
/** Until it's measured: eight rows and the footer */
const GUESS_HEIGHT = 240

const STYLE_PROPS = [
  'boxSizing', 'width', 'height', 'overflowX', 'overflowY', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'fontStyle', 'fontVariant', 'fontWeight', 'fontStretch', 'fontSize',
  'lineHeight', 'fontFamily', 'textAlign', 'textTransform', 'textIndent', 'letterSpacing', 'wordSpacing', 'tabSize', 'whiteSpace', 'wordWrap',
] as const

/**
 * The caret's place in a textarea: a hidden copy of the box with the text up
 * to the caret, and a marker where the caret is.
 */
export function caretRectInTextarea(el: HTMLTextAreaElement, pos: number): CaretRect {
  const box = el.getBoundingClientRect()
  const style = window.getComputedStyle(el)
  const mirror = document.createElement('div')
  for (const p of STYLE_PROPS) mirror.style[p] = style[p]
  mirror.style.position = 'absolute'
  mirror.style.visibility = 'hidden'
  mirror.style.whiteSpace = 'pre-wrap'
  mirror.style.overflowWrap = 'break-word'
  mirror.style.top = '0'
  mirror.style.left = '-9999px'
  mirror.textContent = el.value.slice(0, pos)
  const marker = document.createElement('span')
  marker.textContent = '\u200b'
  mirror.appendChild(marker)
  document.body.appendChild(mirror)
  const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.4 || 20
  const top = box.top + marker.offsetTop - el.scrollTop
  const left = box.left + marker.offsetLeft - el.scrollLeft
  mirror.remove()
  // jsdom has no layout: fall back to the box's own corner
  if (!box.width && !box.height) return { top: box.top, bottom: box.bottom, left: box.left }
  return { top, bottom: top + lineHeight, left }
}

let emptyShown = false
/** The "No snippets yet" row is offered once per session; true the first time only */
export function claimEmptySnippetHint(): boolean {
  if (emptyShown) return false
  emptyShown = true
  return true
}
/** For tests */
export function resetEmptySnippetHint(): void { emptyShown = false }

/** What "/" and the text typed since should open: matches, the one-time empty row, or nothing */
export function menuFor(snippets: Snippet[], query: string, current: SnippetMenuState | null): SnippetMenuState | null {
  if (snippets.length === 0) {
    // Still typing the same trigger: keep the row up
    if (current?.empty) return { items: [], query, empty: true }
    return /^[a-z]/i.test(query) && claimEmptySnippetHint() ? { items: [], query, empty: true } : null
  }
  const items = matchSnippets(snippets, query)
  return items.length > 0 ? { items, query } : null
}

/**
 * The menu's keys, for the text box's keydown (capture for tiptap). Returns
 * true when the key was the menu's.
 */
export function handleSnippetMenuKey(
  e: React.KeyboardEvent,
  menu: SnippetMenuState | null,
  selected: number,
  actions: { select: (i: number) => void; pick: (s: Snippet) => void; close: () => void },
): boolean {
  if (!menu) return false
  if (e.key === 'Escape') { e.preventDefault(); actions.close(); return true }
  if (menu.items.length === 0) return false
  if (e.key === 'ArrowDown') { e.preventDefault(); actions.select(Math.min(selected + 1, menu.items.length - 1)); return true }
  if (e.key === 'ArrowUp') { e.preventDefault(); actions.select(Math.max(selected - 1, 0)); return true }
  if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey && !isMod(e) && !e.altKey)) {
    e.preventDefault()
    actions.pick(menu.items[Math.max(0, Math.min(selected, menu.items.length - 1))]!)
    return true
  }
  return false
}

/** For the text box's role="status" line */
export function snippetStatusText(menu: SnippetMenuState | null): string {
  if (!menu) return ''
  if (menu.empty) return 'No snippets yet.'
  const n = menu.items.length
  return `${n} ${n === 1 ? 'snippet matches' : 'snippets match'}. Enter or Tab inserts the highlighted one; the up and down arrows pick another.`
}

interface Props {
  /** The listbox's id, for the text box's aria-controls */
  id: string
  menu: SnippetMenuState
  selected: number
  caret: CaretRect | null
  onPick: (s: Snippet) => void
  onClose: () => void
}

export function SnippetMenu({ id, menu, selected, caret, onPick, onClose }: Props): React.ReactElement {
  const ref = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState(GUESS_HEIGHT)
  useLayoutEffect(() => {
    const h = ref.current?.getBoundingClientRect().height
    if (h && h !== height) setHeight(h)
  }, [menu, height])

  const vw = window.innerWidth || 1024
  const vh = window.innerHeight || 768
  const c = caret ?? { top: vh / 2, bottom: vh / 2, left: EDGE }
  const below = vh - c.bottom - GAP - EDGE
  const above = c.top - GAP - EDGE
  const flip = below < height && above > below
  const top = flip ? Math.max(EDGE, c.top - GAP - height) : c.bottom + GAP
  const width = Math.min(MENU_WIDTH, vw - 2 * EDGE)
  const left = Math.max(EDGE, Math.min(c.left, vw - width - EDGE))

  return createPortal(
    <div ref={ref} data-testid="snippet-menu"
      className={`fixed ${LAYER.popover} bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg shadow-lg py-1 overflow-y-auto`}
      style={{ top, left, width, maxHeight: Math.max(120, flip ? above : below) }}>
      {menu.empty ? (
        <button type="button"
          onMouseDown={e => e.preventDefault()}
          onClick={() => { onClose(); window.location.hash = '#/snippets' }}
          className="w-full px-3 py-3 text-left text-base text-slate-700 dark:text-slate-200 hover:bg-blue-50 dark:hover:bg-blue-900/20 focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500">
          No snippets yet. Make one…
        </button>
      ) : (
        <div id={id} role="listbox" aria-label="Snippets">
          {menu.items.map((s, i) => (
            <div key={s.id} id={`${id}-opt-${i}`} role="option" aria-selected={i === selected}
              onMouseDown={e => { e.preventDefault(); onPick(s) }}
              className={`flex items-start gap-2 w-full min-h-11 px-3 py-2 text-left cursor-pointer ${i === selected ? 'bg-blue-100 dark:bg-blue-900/40' : 'hover:bg-blue-50 dark:hover:bg-blue-900/20'}`}>
              <span className="text-base font-mono text-blue-700 dark:text-blue-300 flex-shrink-0">/{s.trigger_text}</span>
              <span className="text-base text-slate-600 dark:text-slate-300 truncate">{s.expansion.slice(0, 60)}</span>
            </div>
          ))}
        </div>
      )}
      <div aria-hidden="true" className="px-3 py-1 border-t border-slate-200 dark:border-slate-700 mt-1">
        <span className="text-base text-slate-500 dark:text-slate-400">{menu.empty ? 'Esc closes' : 'Enter or Tab inserts · ↑↓ picks another · Esc closes'}</span>
      </div>
    </div>,
    document.body,
  )
}
