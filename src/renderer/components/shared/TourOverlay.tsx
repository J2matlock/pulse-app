/**
 * TourOverlay — Rich interactive tour shown after onboarding.
 * Highlights key UI areas with spotlight cutout, icons, and friendly descriptions.
 * Designed for non-tech-savvy users (care coordinators, social workers).
 *
 * Must be rendered INSIDE HashRouter and ALONGSIDE the main app layout
 * so that data-tour target elements exist in the DOM.
 *
 * Each step specifies a `route` — the tour navigates there before highlighting.
 */
import { DEBOUNCE_CELL_SAVE, DEBOUNCE_RESIZE } from '../../../shared/constants'
import React, { useState, useEffect, useCallback, useRef } from 'react'
import {
  Sparkles,
  ArrowRight,
  ArrowLeft,
  X,
} from 'lucide-react'
import { useVocab } from '../../hooks/useVocab'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import { modHelp } from '../../utils/keys'
import { STEPS, FIRST_RUN_TOUR, tourSteps } from './tourSteps'
import { computeTooltipPosition } from './tourPosition'

export { STEPS, FIRST_RUN_TOUR, tourSteps, type TourStep } from './tourSteps'
export { computeTooltipPosition } from './tourPosition'

interface Props {
  onComplete: () => void
  /** Every step (Help's "Retake full tour"); otherwise the short first-run tour */
  full?: boolean
}

export function TourOverlay({ onComplete, full = false }: Props): React.ReactElement {
  const { f } = useVocab(null)
  const [stepIndex, setStepIndex] = useState(0)
  const nextRef = useRef<HTMLButtonElement>(null)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const [isAnimating, setIsAnimating] = useState(false)
  const [tooltipHeight, setTooltipHeight] = useState(350)
  const tooltipRef = useRef<HTMLDivElement>(null)
  const prevStepRef = useRef(0)

  // The short tour (or every step), minus switched-off features and steps that don't apply
  const activeSteps = tourSteps(full ? STEPS : STEPS.filter(s => FIRST_RUN_TOUR.includes(s.id)))
  const step = activeSteps[stepIndex]

  // Keyboard and screen-reader users land on Next at each step
  useEffect(() => {
    const t = setTimeout(() => nextRef.current?.focus(), 50)
    return () => clearTimeout(t)
  }, [stepIndex])

  // Navigate to the step's route if specified
  useEffect(() => {
    if (!step) return
    if (step.route && window.location.hash !== step.route) {
      window.location.hash = step.route
    }
  }, [step])

  // Find and measure the target element, with retry for route transitions
  const measureTarget = useCallback(() => {
    if (!step) return
    const el = document.querySelector(step.target)
    if (el) {
      setRect(el.getBoundingClientRect())
    } else {
      setRect(null)
    }
  }, [step])

  useEffect(() => {
    // Wait for route transition + DOM render, then measure
    const timers = [
      setTimeout(measureTarget, 100),
      setTimeout(measureTarget, DEBOUNCE_CELL_SAVE),
      setTimeout(() => {
        measureTarget()
        setIsAnimating(false)
      }, DEBOUNCE_RESIZE),
    ]
    window.addEventListener('resize', measureTarget)
    return () => {
      timers.forEach(clearTimeout)
      window.removeEventListener('resize', measureTarget)
    }
  }, [measureTarget])

  // Measure tooltip height after render for accurate positioning
  useEffect(() => {
    if (tooltipRef.current) {
      setTooltipHeight(tooltipRef.current.offsetHeight)
    }
  }, [stepIndex, isAnimating])

  function goTo(index: number) {
    setIsAnimating(true)
    prevStepRef.current = stepIndex
    setStepIndex(index)
  }

  function next() {
    if (stepIndex < activeSteps.length - 1) {
      goTo(stepIndex + 1)
    } else {
      // Navigate back to grid before completing
      window.location.hash = '#/grid'
      onComplete()
    }
  }

  function prev() {
    if (stepIndex > 0) {
      goTo(stepIndex - 1)
    }
  }

  // Tab stays in the card, Escape skips the tour, and focus goes back where it was
  useFocusTrap(tooltipRef, true, { onEscape: () => { window.location.hash = '#/grid'; onComplete() } })

  // Handle keyboard nav
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Enter is the focused button's own (Next, Back, Skip); arrows move from anywhere
      if (e.key === 'ArrowRight') { next() }
      if (e.key === 'ArrowLeft') { prev() }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  })

  if (!step) return <></>

  const vh = window.innerHeight
  const vw = window.innerWidth

  const basePosition = computeTooltipPosition(rect, step.position, tooltipHeight, { width: vw, height: vh })
  const tooltipStyle: React.CSSProperties = {
    ...basePosition,
    transition: 'all 0.3s ease-out',
    opacity: isAnimating ? 0 : 1,
  }

  // Spotlight cutout
  const spotlightStyle: React.CSSProperties = rect
    ? {
        position: 'fixed',
        top: rect.top - 6,
        left: rect.left - 6,
        width: rect.width + 12,
        height: rect.height + 12,
        borderRadius: 10,
        boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.5)',
        zIndex: 10000,
        pointerEvents: 'none',
        transition: 'all 0.3s ease-out',
      }
    : {
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.5)',
        zIndex: 10000,
        pointerEvents: 'none',
      }

  // Pulsing ring around spotlight
  const pulseRingStyle: React.CSSProperties = rect
    ? {
        position: 'fixed',
        top: rect.top - 10,
        left: rect.left - 10,
        width: rect.width + 20,
        height: rect.height + 20,
        borderRadius: 12,
        border: '2px solid rgba(59, 130, 246, 0.5)',
        zIndex: 10000,
        pointerEvents: 'none',
        animation: 'tour-pulse 2s ease-in-out infinite',
        transition: 'all 0.3s ease-out',
      }
    : { display: 'none' }

  return (
    <>
      {/* Pulse animation keyframes */}
      <style>{`
        @keyframes tour-pulse {
          0%, 100% { opacity: 0.4; transform: scale(1); }
          50% { opacity: 1; transform: scale(1.02); }
        }
      `}</style>

      {/* Clicks outside the card do nothing: only Next moves on */}
      <div className="fixed inset-0 z-[9999]">
        {/* Spotlight cutout */}
        <div style={spotlightStyle} />
        {/* Pulse ring */}
        <div style={pulseRingStyle} />

        {/* Tooltip card */}
        <div
          ref={tooltipRef}
          style={tooltipStyle}
          role="dialog"
          aria-modal="true"
          aria-labelledby="tour-step-title"
          aria-describedby="tour-step-text"
          className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden"
        >
          {/* Header with icon and step counter */}
          <div className="bg-linear-to-r from-blue-600 to-blue-700 dark:from-blue-700 dark:to-blue-800 px-5 py-3 flex items-center gap-3">
            <div className="w-9 h-9 bg-white/20 rounded-xl flex items-center justify-center text-white flex-shrink-0">
              {step.icon}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-white/70 text-sm font-medium">
                Step {stepIndex + 1} of {activeSteps.length}
              </div>
              <h2 id="tour-step-title" className="text-white text-base font-bold leading-tight truncate">
                {f(step.title)}
              </h2>
            </div>
            <button
              onClick={() => { window.location.hash = '#/grid'; onComplete() }}
              className="hit-44 w-8 h-8 flex items-center justify-center rounded-lg text-white/60 hover:text-white hover:bg-white/10 transition-colors flex-shrink-0"
              title="Skip tour (Esc)"
              aria-label="Skip tour"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Body */}
          <div className="px-5 py-4">
            <div className="flex items-center gap-2 mb-1.5">
              <Sparkles className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" />
              <span className="text-sm font-semibold text-blue-600 dark:text-blue-400">
                {f(step.subtitle)}
              </span>
            </div>

            <p id="tour-step-text" className="text-[15px] leading-relaxed text-slate-700 dark:text-slate-300 mb-3">
              {modHelp(f(step.description))}
            </p>

            {step.tip && (
              <div className="bg-blue-50 dark:bg-blue-900/30 border border-blue-100 dark:border-blue-800 rounded-lg px-3 py-2 mb-3">
                <p className="text-sm text-blue-800 dark:text-blue-300">
                  <span className="font-semibold">Tip:</span> {modHelp(f(step.tip))}
                </p>
              </div>
            )}


            {/* Navigation buttons */}
            <div className="flex items-center justify-between">
              <button
                onClick={prev}
                disabled={stepIndex === 0}
                className={`hit-44 flex items-center gap-1.5 px-3 py-2 text-base font-medium rounded-xl transition-colors ${
                  stepIndex === 0
                    ? 'text-slate-300 dark:text-slate-500 cursor-not-allowed'
                    : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'
                }`}
              >
                <ArrowLeft className="w-4 h-4" /> Back
              </button>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => { window.location.hash = '#/grid'; onComplete() }}
                  className="hit-44 px-3 py-2 text-base text-slate-500 dark:text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"
                >
                  Skip tour
                </button>
                <button
                  ref={nextRef}
                  onClick={next}
                  className="hit-44 flex items-center gap-1.5 px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-base font-semibold rounded-xl transition-colors shadow-xs"
                >
                  {stepIndex < activeSteps.length - 1 ? (
                    <>Next <ArrowRight className="w-4 h-4" /></>
                  ) : (
                    <>Get started! <Sparkles className="w-4 h-4" /></>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
