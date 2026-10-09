import React, { useState, useRef, useEffect } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { tooltipVariants } from '../../utils/animations'

interface TooltipProps {
  content: string
  children: React.ReactElement
  placement?: 'top' | 'bottom' | 'left' | 'right'
  delay?: number
}

/**
 * Simple hover tooltip. Wraps a single child element.
 * Respects prefers-reduced-motion — tooltip appears instantly when motion is reduced.
 */
export function Tooltip({ content, children, placement = 'top', delay = 400 }: TooltipProps): React.ReactElement {
  const [visible, setVisible] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [pos, setPos] = useState({ top: 0, left: 0 })
  const wrapRef = useRef<HTMLDivElement>(null)

  function show() {
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
    if (timerRef.current) clearTimeout(timerRef.current)
    setVisible(false)
  }

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current) }, [])

  const placementClass =
    placement === 'top'    ? '-translate-x-1/2 -translate-y-full -mt-1.5' :
    placement === 'bottom' ? '-translate-x-1/2 mt-1.5' :
    placement === 'left'   ? '-translate-x-full -translate-y-1/2 -ml-1.5' :
    '-translate-y-1/2 ml-1.5'

  return (
    <>
      <div ref={wrapRef} style={{ display: 'contents' }} onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide} onContextMenu={hide}>
        {children}
      </div>
      <AnimatePresence>
        {visible && content && (
          <motion.div
            role="tooltip"
            className={`fixed z-[300] pointer-events-none ${placementClass}`}
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
