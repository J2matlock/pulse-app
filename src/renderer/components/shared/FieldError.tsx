/**
 * Ties a form field to its error text (WCAG 3.3.1, 4.1.3): the field gets
 * aria-invalid and aria-describedby, and the error is announced when it shows,
 * so a screen reader user hears what's wrong and which field it belongs to.
 */
import React from 'react'

type ErrorValue = string | null | undefined | false

/** id of the error text for the field with this id */
export function fieldErrorId(fieldId: string): string {
  return `${fieldId}-error`
}

/**
 * Spread onto the input. `describedBy` keeps a hint the field already points at.
 */
export function fieldErrorProps(fieldId: string, error: ErrorValue, describedBy?: string): { 'aria-invalid'?: true; 'aria-describedby'?: string } {
  if (!error) return describedBy ? { 'aria-describedby': describedBy } : {}
  return { 'aria-invalid': true, 'aria-describedby': describedBy ? `${describedBy} ${fieldErrorId(fieldId)}` : fieldErrorId(fieldId) }
}

interface FieldErrorProps {
  fieldId: string
  error: ErrorValue
  className?: string
  /** Announce the error as soon as it appears. Off for errors that update on every keystroke. */
  announce?: boolean
}

export function FieldError({ fieldId, error, className = 'mt-1 text-sm text-red-600 dark:text-red-400', announce = true }: FieldErrorProps): React.ReactElement | null {
  if (!error) return null
  return <p id={fieldErrorId(fieldId)} role={announce ? 'alert' : undefined} className={className}>{error}</p>
}
