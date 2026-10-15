/**
 * A count that ticks when it changes (Q6): the old number slides up and
 * fades, the new one comes in from below, in 120 ms, so a tile shows that
 * Done took one off. Digits are tabular so the width doesn't jump. The first
 * value just shows; under reduced motion every change is a plain swap.
 */
import React from 'react'
import { AnimatePresence, motion, useReducedMotionConfig } from 'motion/react'
import { MOTION, easeOut } from '../../utils/animations'

export function TickingNumber({ value, className }: { value: number | string; className?: string }): React.ReactElement {
  const reduced = useReducedMotionConfig()
  const cls = `tabular-nums ${className ?? ''}`
  if (reduced) return <span className={cls}>{value}</span>
  return (
    <span className={`relative inline-flex overflow-hidden ${cls}`} data-testid="ticking-number">
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={String(value)}
          initial={{ y: '60%', opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: '-60%', opacity: 0 }}
          transition={{ duration: MOTION.fast, ease: easeOut }}
        >
          {value}
        </motion.span>
      </AnimatePresence>
    </span>
  )
}
