import React from 'react'
import { PrimaryButton } from '../ui/Button'

export type EmptyStateSize = 'page' | 'panel' | 'inline'

interface EmptyStateProps {
  icon?: React.ReactNode
  title: string
  description?: string
  action?: {
    label: string
    onClick: () => void
  }
  /** A quieter second way in ("Import a spreadsheet"), drawn as a link-style button */
  secondaryAction?: {
    label: string
    onClick: () => void
  }
  /**
   * page (default): a whole screen with nothing in it, icon in a 56 px circle;
   * panel: a card or side panel, 40 px icon; inline: a line of text in a list, no icon.
   */
  size?: EmptyStateSize
}

const WRAP: Record<EmptyStateSize, string> = {
  page: 'py-16 px-6',
  panel: 'py-8 px-4',
  inline: 'py-3 px-3',
}

/**
 * Friendly empty state for lists and views that have no data yet.
 *
 * Copy rule: the title or description says in one sentence what goes here,
 * and the one action fills it ("No tasks yet" · "Tasks you add show here with
 * their due dates." · [Add task]). Words come from the caller through the
 * vocabulary layer; nothing here names a record or list.
 */
export function EmptyState({ icon, title, description, action, secondaryAction, size = 'page' }: EmptyStateProps): React.ReactElement {
  const inline = size === 'inline'
  return (
    <div className={`flex flex-col ${inline ? 'items-start text-left' : 'items-center justify-center text-center'} ${WRAP[size]}`}>
      {icon && size === 'page' && (
        <div className="mb-4 flex w-14 h-14 items-center justify-center rounded-full bg-accent-soft text-accent [&_svg]:w-7 [&_svg]:h-7">
          {icon}
        </div>
      )}
      {icon && size === 'panel' && (
        <div className="mb-3 text-slate-400 dark:text-slate-500 [&_svg]:w-10 [&_svg]:h-10">
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
      {(action || secondaryAction) && (
        <div className={`mt-4 flex flex-wrap items-center gap-3 ${inline ? '' : 'justify-center'}`}>
          {action && <PrimaryButton onClick={action.onClick}>{action.label}</PrimaryButton>}
          {secondaryAction && (
            <button
              type="button"
              onClick={secondaryAction.onClick}
              className="inline-flex min-h-11 items-center px-2 text-base font-medium text-accent underline-offset-2 hover:underline rounded-lg focus:outline-hidden focus-visible:ring-3 focus-visible:ring-accent"
            >
              {secondaryAction.label}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
