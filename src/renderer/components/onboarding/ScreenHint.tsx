/**
 * ScreenHint — the one-time hint for the screen someone has just reached
 * (UX pass Q7). Mounted once in App.tsx, inside the router; views aren't edited.
 *
 * A small card beside the thing it talks about, with one "Got it". It doesn't
 * block anything: no backdrop, no focus trap, and it never takes focus. It's in
 * a polite live region, so a screen reader reads it out without interrupting.
 * A hint is remembered the moment it shows, so it never repeats. Esc closes it,
 * and it's placed on a side of its target where it covers none of it (persona
 * study: bubbles sat on the icons they described and ignored Esc).
 */
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { Lightbulb } from 'lucide-react'
import { useVocab } from '../../hooks/useVocab'
import { useHintStore } from '../../stores/hintStore'
import { SecondaryButton } from '../ui/Button'
import type { TourRect } from '../shared/tourPosition'
import { hintForRoute, type HintId, type ScreenHintDef } from './screenHints'

/** Long enough for the screen to settle, short enough to feel like part of arriving */
export const HINT_SETTLE_MS = 800
/** How long a missing target is waited for before this visit gives up (it's tried again next visit) */
export const HINT_TARGET_WAIT_MS = 4000
const RECHECK_MS = 500
const CARD_WIDTH = 360
const EDGE = 16
const GAP = 12

/**
 * Something else is up: a dialog, a menu, the colour key, the first look. A hint waits until
 * it's gone, and goes away if one opens over it (persona study, Linda: the colour key opened
 * on top of a bubble)
 */
const OTHER_LAYER = ['[aria-modal="true"]', '[data-popover-open]', ...['dialog', 'alertdialog', 'menu'].map(r => `[role="${r}"]`)].join(', ')
const otherLayerOpen = () => document.querySelector(OTHER_LAYER) !== null

type Side = 'top' | 'bottom' | 'left' | 'right'
const OPPOSITE: Record<Side, Side> = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' }

/**
 * Where the card goes: the preferred side of its target, else the opposite one, else the
 * other two, on the first side where it fits on screen without covering the target. With
 * no such side, the one with the most room.
 */
export function placeHint(
  target: TourRect,
  card: { width: number; height: number },
  viewport: { width: number; height: number },
  preferred: Side = 'bottom',
): { left: number; top: number; side: Side } {
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, Math.max(lo, hi)))
  const at = (side: Side): { left: number; top: number; room: number } => {
    switch (side) {
      case 'right': return { left: target.right + GAP, top: clamp(target.top, EDGE, viewport.height - card.height - EDGE), room: viewport.width - EDGE - target.right - GAP - card.width }
      case 'left': return { left: target.left - GAP - card.width, top: clamp(target.top, EDGE, viewport.height - card.height - EDGE), room: target.left - GAP - card.width - EDGE }
      case 'bottom': return { top: target.bottom + GAP, left: clamp(target.left, EDGE, viewport.width - card.width - EDGE), room: viewport.height - EDGE - target.bottom - GAP - card.height }
      case 'top': return { top: target.top - GAP - card.height, left: clamp(target.left, EDGE, viewport.width - card.width - EDGE), room: target.top - GAP - card.height - EDGE }
    }
  }
  const order: Side[] = [preferred, OPPOSITE[preferred], ...(['bottom', 'right', 'top', 'left'] as Side[]).filter(x => x !== preferred && x !== OPPOSITE[preferred])]
  const tried = order.map(side => ({ side, ...at(side) }))
  const best = tried.find(c => c.room >= 0) ?? tried.reduce((a, b) => (b.room > a.room ? b : a))
  return {
    side: best.side,
    left: clamp(best.left, EDGE, viewport.width - card.width - EDGE),
    top: clamp(best.top, EDGE, viewport.height - card.height - EDGE),
  }
}

interface Shown { id: HintId; hint: ScreenHintDef; target: Element | null }

export function ScreenHint({ blocked }: {
  /** A tour, a "Show me", the first look or focus mode is running: no hint on this visit */
  blocked: boolean
}): React.ReactElement {
  const { pathname } = useLocation()
  const { f } = useVocab(null)
  const loaded = useHintStore(s => s.seen !== null)
  const [shown, setShown] = useState<Shown | null>(null)
  const [rect, setRect] = useState<TourRect | null>(null)
  const [cardHeight, setCardHeight] = useState(120)
  const cardRef = useRef<HTMLDivElement>(null)
  // At most one hint per visit to a screen, and none on a visit something else was teaching
  const spentRef = useRef(false)
  const blockedRef = useRef(blocked)
  blockedRef.current = blocked

  // A new screen is a new visit
  useEffect(() => {
    spentRef.current = blockedRef.current
    setShown(null)
  }, [pathname])

  useEffect(() => {
    if (!blocked) return
    spentRef.current = true
    setShown(null)
  }, [blocked])

  // Wait for the screen to settle, then show its hint if nothing else is in the way
  useEffect(() => {
    if (!loaded || blocked || spentRef.current) return
    const match = hintForRoute(pathname)
    if (!match || useHintStore.getState().isSeen(match.id)) return
    let waited = 0
    let timer: ReturnType<typeof setTimeout>
    const attempt = () => {
      if (spentRef.current) return
      const target = match.hint.target ? document.querySelector(match.hint.target) : null
      // A dialog or pop-up (the morning briefing, the colour key) is waited out; a missing target only for a while
      if (otherLayerOpen() || (match.hint.target && !target)) {
        if (!otherLayerOpen()) waited += RECHECK_MS
        if (waited <= HINT_TARGET_WAIT_MS) timer = setTimeout(attempt, RECHECK_MS)
        return
      }
      spentRef.current = true
      useHintStore.getState().markSeen(match.id)
      setShown({ id: match.id, hint: match.hint, target })
    }
    timer = setTimeout(attempt, HINT_SETTLE_MS)
    return () => clearTimeout(timer)
  }, [pathname, blocked, loaded])

  const close = useCallback(() => setShown(null), [])

  // A list redraws its rows, so the target is looked up again rather than held;
  // a moment without it keeps the last place
  const measure = useCallback(() => {
    if (!shown?.target) { setRect(null); return }
    const target = shown.target.isConnected ? shown.target : (shown.hint.target ? document.querySelector(shown.hint.target) : null)
    if (target) setRect(target.getBoundingClientRect())
  }, [shown])

  useLayoutEffect(() => {
    if (!shown) return
    measure()
    if (cardRef.current) setCardHeight(cardRef.current.offsetHeight)
  }, [shown, measure])

  // While it's up: follow the target, go away if a dialog opens, and close when the target is used
  useEffect(() => {
    if (!shown) return
    const interval = setInterval(() => { if (otherLayerOpen()) setShown(null); else measure() }, RECHECK_MS)
    window.addEventListener('resize', measure)
    const selector = shown.hint.target
    const onClick = (e: MouseEvent) => {
      if (selector && e.target instanceof Element && e.target.closest(selector)) setShown(null)
    }
    // Esc closes it (it was marked seen when it showed). Not while a menu or dialog is up:
    // that Esc is theirs, and the hint has gone anyway
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !otherLayerOpen()) setShown(null) }
    document.addEventListener('click', onClick, true)
    document.addEventListener('keydown', onKey)
    return () => {
      clearInterval(interval)
      window.removeEventListener('resize', measure)
      document.removeEventListener('click', onClick, true)
      document.removeEventListener('keydown', onKey)
    }
  }, [shown, measure])

  let style: React.CSSProperties | undefined
  if (shown) {
    const width = Math.min(CARD_WIDTH, window.innerWidth - 2 * EDGE)
    if (shown.target && rect) {
      const place = placeHint(rect, { width, height: cardHeight }, { width: window.innerWidth, height: window.innerHeight }, shown.hint.position ?? 'bottom')
      style = { position: 'fixed', left: place.left, top: place.top, width }
    } else {
      // No target: bottom-right, above the status bar
      style = { position: 'fixed', right: 24, bottom: 64, maxWidth: CARD_WIDTH, width: `min(${CARD_WIDTH}px, calc(100vw - 48px))` }
    }
    // Below dialogs (z 200), so a dialog that opens is never underneath it
    style = { ...style, zIndex: 150 }
  }

  return (
    <div role="status" aria-live="polite">
      {shown && style && (
        <div
          ref={cardRef}
          style={style}
          data-testid="screen-hint"
          className="rounded-lg border border-slate-200 bg-white p-4 shadow-xl dark:border-slate-700 dark:bg-slate-800"
        >
          <div className="flex items-start gap-3">
            <Lightbulb className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-500 dark:text-amber-300" aria-hidden="true" />
            <p className="text-base text-slate-700 dark:text-slate-200">{f(shown.hint.text)}</p>
          </div>
          <div className="mt-3 flex justify-end">
            <SecondaryButton onClick={close}>Got it</SecondaryButton>
          </div>
        </div>
      )}
    </div>
  )
}
