/**
 * The top of a screen: one 20 px title, one sentence under it saying what the
 * screen is for, and its actions on the right — the main one last (Q2: one
 * obvious next step per screen).
 *
 *   <PageHeader
 *     title="Tasks"
 *     description="Things to do that aren't about one person."
 *     actions={<SecondaryButton size="compact">Add a group</SecondaryButton>}
 *     primary={<PrimaryButton size="compact" icon={<Plus />}>Add task</PrimaryButton>}
 *   />
 *
 * - breadcrumb: shown above the title (e.g. <ViewBreadcrumb />).
 * - title can hold more than words (a count after it), but keep it short.
 * - Other props (data-tour, data-testid, id, className) go on the <header>.
 * Words come from the caller through the vocabulary layer.
 */
import React from 'react'

export interface PageHeaderProps extends Omit<React.HTMLAttributes<HTMLElement>, 'title'> {
  title: React.ReactNode
  description?: React.ReactNode
  /** The one main action, drawn last (right-most) */
  primary?: React.ReactNode
  /** Other actions, before the main one */
  actions?: React.ReactNode
  breadcrumb?: React.ReactNode
}

export function PageHeader({ title, description, primary, actions, breadcrumb, className, ...rest }: PageHeaderProps): React.ReactElement {
  return (
    <header className={`flex flex-wrap items-start justify-between gap-4 ${className ?? ''}`} {...rest}>
      <div className="min-w-0 flex-1">
        {breadcrumb && <div className="mb-1">{breadcrumb}</div>}
        <h1 className="text-2xl font-semibold text-slate-800 dark:text-slate-100">{title}</h1>
        {description && <p className="mt-1 max-w-prose text-base text-slate-600 dark:text-slate-300">{description}</p>}
      </div>
      {(actions || primary) && (
        <div className="flex flex-wrap items-center gap-2">
          {actions}
          {primary}
        </div>
      )}
    </header>
  )
}
