import React from 'react'

export function Badge({ children, variant = 'default' }: { children: React.ReactNode; variant?: 'default' | 'blue' | 'green' }): React.ReactElement {
  const cls =
    variant === 'blue'
      ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
      : variant === 'green'
      ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
      : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
  return (
    <span className={`inline-flex items-center flex-shrink-0 whitespace-nowrap px-2 py-0.5 rounded-sm text-sm font-medium ${cls}`}>
      {children}
    </span>
  )
}
