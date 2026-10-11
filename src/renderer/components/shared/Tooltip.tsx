import React, { useState, useRef, useEffect, useId, cloneElement, isValidElement } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { tooltipVariants } from '../../utils/animations'

interface TooltipProps {
  content: string
  children: React.ReactElement
  placement?: 'top' | 'bottom' | 'left' | 'right'
  delay?: number
}

/** How long the tooltip waits after the pointer leaves, so it can move onto the tooltip (WCAG 1.4.13) */
const HIDE_GRACE_MS = 150

/**
 * Simple hover tooltip. Wraps a single child element.
 * Respects prefers-reduced-motion — tooltip appears instantly when motion is reduced.
 * Escape hides it, and it stays while the pointer is over it (WCAG 1.4.13).
 */
export function Tooltip({ content, children, placement = 'top', delay = 400 }: TooltipProps): React.ReactElement {
  const [visible, setVisible] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [pos, setPos] = useState({ top: 0, left: 0 })
  const wrapRef = useRef<HTMLDivElement>(null)
  const tooltipId = useId()

  function clearTimer() {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = null
  }

  function show() {
    clearTimer()
    if (visible) return
    timerRef.current = setTimeout(() => {
      if (!wrapRef.current) return
      const rect = wrapRef.current.getBoundingClientRect()
      if (rect.width === 0 && rect.height === 0) return // display:contents — no box
      const GAP = 6
      let top = 0, left = 0
      switch (placement) {
        case 'top':    top = rect.top - GAP;    left = rect.left + rect.width / 2; break
        case 'bottom': top = rect.bottom + GAP; left = rect.left + rect.width / 2; break
        case 'left':   top = rect.top + rect.height / 2; left = rect.left - GAP;   break
        case 'right':  top = rect.top + rect.height / 2; left = rect.right + GAP;  break
      }
      setPos({ top, left })
      setVisible(true)
    }, delay)
  }

  function hide() {
    clearTimer()
    setVisible(false)
  }

  function hideSoon() {
    if (!visible) { hide(); return }
    clearTimer()
    timerRef.current = setTimeout(() => setVisible(false), HIDE_GRACE_MS)
  }

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current) }, [])

  useEffect(() => {
    if (!visible) return
    function onKey(e: KeyboardEvent) {
      // Only hide the tooltip; let Escape keep doing its other jobs (closing a dialog etc.)
      if (e.key === 'Escape') setVisible(false)
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [visible])

  // Link the hint to its trigger while it shows, unless the trigger already says the same thing
  const childProps = isValidElement(children) ? (children.props as { 'aria-label'?: string; title?: string; 'aria-describedby'?: string }) : {}
  const describe = visible && !!content && typeof children.type === 'string'
    && childProps['aria-label'] !== content && childProps.title !== content
  const child = describe ? cloneElement(children as React.ReactElement<{ 'aria-describedby'?: string }>, { 'aria-describedby': [childProps['aria-describedby'], tooltipId].filter(Boolean).join(' ') }) : children

  const placementClass =
    placement === 'top'    ? '-translate-x-1/2 -translate-y-full -mt-1.5' :
    placement === 'bottom' ? '-translate-x-1/2 mt-1.5' :
    placement === 'left'   ? '-translate-x-full -translate-y-1/2 -ml-1.5' :
    '-translate-y-1/2 ml-1.5'

  return (
    <>
      <div ref={wrapRef} style={{ display: 'contents' }} onMouseEnter={show} onMouseLeave={hideSoon} onFocus={show} onBlur={hide} onContextMenu={hide}>
        {child}
      </div>
      <AnimatePresence>
        {visible && content && (
          <motion.div
            id={tooltipId}
            role="tooltip"
            className={`fixed z-[300] ${placementClass}`}
            onMouseEnter={clearTimer}
            onMouseLeave={hide}
            style={{ top: pos.top, left: pos.left }}
            variants={tooltipVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
          >
            <div className="bg-slate-800 dark:bg-slate-900 text-white px-2.5 py-1.5 rounded-md shadow-lg max-w-xs whitespace-nowrap" style={{ fontSize: 15 }}>
              {content}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
