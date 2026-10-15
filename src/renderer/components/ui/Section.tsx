/**
 * A part of a screen with its own 18 px heading: space, not a border, sets it
 * apart (32 px from the section before it).
 *
 *   <Section title="Backups" description="Where Pulse keeps copies of your data."
 *     actions={<SecondaryButton size="compact">Back up now</SecondaryButton>}>
 *     …
 *   </Section>
 *
 * The heading is an <h2> that names the <section> for screen readers. Other
 * props (data-tour, data-testid, id, className) go on the <section>. Words
 * come from the caller through the vocabulary layer.
 */
import React, { useId } from 'react'

export interface SectionProps extends Omit<React.HTMLAttributes<HTMLElement>, 'title'> {
  title: React.ReactNode
  description?: React.ReactNode
  /** Buttons on the heading's right */
  actions?: React.ReactNode
  children?: React.ReactNode
}

export function Section({ title, description, actions, children, className, ...rest }: SectionProps): React.ReactElement {
  const headingId = useId()
  return (
    <section aria-labelledby={headingId} className={`pt-8 first:pt-0 ${className ?? ''}`} {...rest}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h2 id={headingId} className="text-xl font-semibold text-slate-800 dark:text-slate-100">{title}</h2>
          {description && <p className="mt-1 max-w-prose text-base text-slate-600 dark:text-slate-300">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children !== undefined && children !== null && <div className="mt-4">{children}</div>}
    </section>
  )
}
