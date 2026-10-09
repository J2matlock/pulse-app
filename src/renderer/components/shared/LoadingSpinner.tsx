import React from 'react'

interface LoadingSpinnerProps {
  size?: 'sm' | 'md' | 'lg'
  label?: string
  className?: string
}

/**
 * Accessible animated spinner. Respects prefers-reduced-motion.
 */
export function LoadingSpinner({ size = 'md', label = 'Loading…', className = '' }: LoadingSpinnerProps): React.ReactElement {
  const sizeClass =
    size === 'sm' ? 'w-4 h-4 border-2' :
    size === 'lg' ? 'w-10 h-10 border-4' :
    'w-6 h-6 border-2'

  return (
    <span
      role="status"
      aria-label={label}
      className={`inline-block ${className}`}
    >
      <span
        className={`block rounded-full border-slate-200 dark:border-slate-700 border-t-blue-500 dark:border-t-blue-400 animate-spin ${sizeClass}`}
      />
      <span className="sr-only">{label}</span>
    </span>
  )
}

/**
 * Full-area loading state — centered spinner with optional label.
 */
export function LoadingOverlay({ label = 'Loading…' }: { label?: string }): React.ReactElement {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-slate-500 dark:text-slate-400">
      <LoadingSpinner size="lg" label={label} />
      <span className="text-base">{label}</span>
    </div>
  )
}
