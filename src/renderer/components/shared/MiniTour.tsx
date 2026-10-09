/**
 * MiniTour — Plays a subset of tour steps (used by Help Center "Show me" buttons).
 * Reuses spotlight/tooltip rendering from TourOverlay but for a smaller step set.
 * Returns to the specified route (default: #/help) on complete.
 */
import React, { useState, useEffect, useCallback, useRef } from 'react'
import { ArrowRight, ArrowLeft, X, Sparkles } from 'lucide-react'
import type { TourStep } from './TourOverlay'
import { computeTooltipPosition } from './TourOverlay'
import { DEBOUNCE_CELL_SAVE, DEBOUNCE_RESIZE } from '../../../shared/constants'
import { useVocab } from '../../hooks/useVocab'

interface MiniTourProps {
  steps: TourStep[]
  onComplete: () => void
  returnRoute?: string
}

export function MiniTour({ steps, onComplete, returnRoute = '#/help' }: MiniTourProps): React.ReactElement {
  const { f } = useVocab(null)
  const [stepIndex, setStepIndex] = useState(0)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const [isAnimating, setIsAnimating] = useState(false)
  const [tooltipHeight, setTooltipHeight] = useState(300)
  const tooltipRef = useRef<HTMLDivElement>(null)
  const step = steps[stepIndex]

  // Navigate to step route
  useEffect(() => {
    if (!step) return
    if (step.route && window.location.hash !== step.route) {
      window.location.hash = step.route
    }
  }, [step])

  // Measure target element
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
    const timers = [
      setTimeout(measureTarget, 100),
      setTimeout(measureTarget, DEBOUNCE_CELL_SAVE),
      setTimeout(measureTarget, DEBOUNCE_RESIZE),
      setTimeout(() => {
        measureTarget()
        setIsAnimating(false)
      }, 700),
    ]
    window.addEventListener('resize', measureTarget)
    return () => {
      timers.forEach(clearTimeout)
      window.removeEventListener('resize', measureTarget)
    }
  }, [measureTarget])

  useEffect(() => {
    if (tooltipRef.current) {
      setTooltipHeight(tooltipRef.current.offsetHeight)
    }
  }, [stepIndex, isAnimating])

  function goTo(index: number) {
    setIsAnimating(true)
    setStepIndex(index)
  }

  function finish() {
    window.location.hash = returnRoute
    onComplete()
  }

  function next() {
    if (stepIndex < steps.length - 1) {
      goTo(stepIndex + 1)
    } else {
      finish()
    }
  }

  function prev() {
    if (stepIndex > 0) {
      goTo(stepIndex - 1)
    }
  }

  // Keyboard nav
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') finish()
      if (e.key === 'ArrowRight' || e.key === 'Enter') next()
      if (e.key === 'ArrowLeft') prev()
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
        animation: 'minitour-pulse 2s ease-in-out infinite',
        transition: 'all 0.3s ease-out',
      }
    : { display: 'none' }

  return (
    <>
      <style>{`
        @keyframes minitour-pulse {
          0%, 100% { opacity: 0.4; transform: scale(1); }
          50% { opacity: 1; transform: scale(1.02); }
        }
      `}</style>

      <div className="fixed inset-0 z-[9999]" onClick={next}>
        <div style={spotlightStyle} />
        <div style={pulseRingStyle} />

        <div
          ref={tooltipRef}
          style={tooltipStyle}
          className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden"
          onClick={e => e.stopPropagation()}
        >
          {/* Header */}
          <div className="bg-linear-to-r from-blue-600 to-blue-700 dark:from-blue-700 dark:to-blue-800 px-5 py-3 flex items-center gap-3">
            <div className="w-9 h-9 bg-white/20 rounded-xl flex items-center justify-center text-white flex-shrink-0">
              {step.icon}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-white/70 text-sm font-medium">
                Step {stepIndex + 1} of {steps.length}
              </div>
              <div className="text-white text-base font-bold leading-tight truncate">
                {f(step.title)}
              </div>
            </div>
            <button
              onClick={finish}
              className="hit-44 w-8 h-8 flex items-center justify-center rounded-lg text-white/60 hover:text-white hover:bg-white/10 transition-colors flex-shrink-0"
              title="Close (Esc)"
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

            <p className="text-[15px] leading-relaxed text-slate-700 dark:text-slate-300 mb-3">
              {f(step.description)}
            </p>

            {step.tip && (
              <div className="bg-blue-50 dark:bg-blue-900/30 border border-blue-100 dark:border-blue-800 rounded-lg px-3 py-2 mb-3">
                <p className="text-sm text-blue-800 dark:text-blue-300">
                  <span className="font-semibold">Tip:</span> {f(step.tip)}
                </p>
              </div>
            )}

            {/* Step dots for small sets */}
            {steps.length <= 8 && (
              <div className="flex gap-1.5 mb-3 justify-center">
                {steps.map((_, i) => (
                  <button
                    key={i}
                    onClick={() => goTo(i)}
                    className={`hit-44 h-2 rounded-full transition-all duration-300 ${
                      i === stepIndex
                        ? 'bg-blue-600 w-6'
                        : i < stepIndex
                          ? 'bg-blue-300 dark:bg-blue-700 w-2'
                          : 'bg-slate-300 dark:bg-slate-600 w-2'
                    }`}
                    title={`Step ${i + 1}`}
                  />
                ))}
              </div>
            )}

            {/* Navigation */}
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
                  onClick={finish}
                  className="hit-44 px-3 py-2 text-base text-slate-500 dark:text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"
                >
                  Back to Help
                </button>
                <button
                  onClick={next}
                  className="hit-44 flex items-center gap-1.5 px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-base font-semibold rounded-xl transition-colors shadow-xs"
                >
                  {stepIndex < steps.length - 1 ? (
                    <>Next <ArrowRight className="w-4 h-4" /></>
                  ) : (
                    <>Done <Sparkles className="w-4 h-4" /></>
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
