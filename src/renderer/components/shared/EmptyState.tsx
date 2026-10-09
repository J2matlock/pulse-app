import React from 'react'

interface EmptyStateProps {
  icon?: React.ReactNode
  title: string
  description?: string
  action?: {
    label: string
    onClick: () => void
  }
}

/**
 * Friendly empty state for lists and views that have no data yet.
 */
export function EmptyState({ icon, title, description, action }: EmptyStateProps): React.ReactElement {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
      {icon && (
        <div className="mb-4 text-slate-300 dark:text-slate-500">
          {icon}
        </div>
      )}
      <h3 className="text-base font-semibold text-slate-700 dark:text-slate-300 mb-1">
        {title}
      </h3>
      {description && (
        <p className="text-base text-slate-500 dark:text-slate-400 max-w-sm">
          {description}
        </p>
      )}
      {action && (
        <button
          onClick={action.onClick}
          className="btn-primary mt-4"
          style={{ minHeight: 44, padding: '0 20px', fontSize: 15 }}
        >
          {action.label}
        </button>
      )}
    </div>
  )
}
