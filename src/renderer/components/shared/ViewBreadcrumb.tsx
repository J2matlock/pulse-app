import React from 'react'
import { ChevronRight } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

export interface BreadcrumbItem {
  label: string
  to?: string
}

interface Props {
  items: BreadcrumbItem[]
}

/**
 * Generic breadcrumb for non-profile views.
 * Usage: <ViewBreadcrumb items={[{ label: 'Home', to: '/grid' }, { label: 'Tasks' }]} />
 */
export function ViewBreadcrumb({ items }: Props): React.ReactElement {
  const navigate = useNavigate()

  return (
    <nav className="flex items-center gap-1 text-sm min-w-0" aria-label="Breadcrumb">
      {items.map((item, i) => {
        const isLast = i === items.length - 1
        return (
          <React.Fragment key={i}>
            {i > 0 && <ChevronRight className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400 flex-shrink-0" />}
            {item.to && !isLast ? (
              <button
                onClick={() => navigate(item.to!)}
                className="hit-44 text-blue-600 dark:text-blue-400 hover:underline font-medium truncate
                           focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500 rounded-sm"
              >
                {item.label}
              </button>
            ) : (
              <span className="text-slate-500 dark:text-slate-400 font-medium truncate">
                {item.label}
              </span>
            )}
          </React.Fragment>
        )
      })}
    </nav>
  )
}
