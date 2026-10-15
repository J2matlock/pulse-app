/**
 * "What do the colors mean?" (B-04, A-11): the colors and shapes of the
 * deadline rules in use, where the colored cells are. The one color key: the
 * clock in a date column's header opens it for that column's rule, the list's
 * footer for every rule the shown columns use, and the dashboard's link for
 * the rules its deadlines use (with a line about the row stripes).
 */
import React, { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { IconButton } from '../ui/Button'
import type { Column, ParsedAlertRule } from '../../../shared/types'
import { takesDeadlineRule } from '../../../shared/types'
import { RuleColorKey } from '../alerts/RuleColorKey'
import { useMenuKeys } from '../../hooks/useMenuKeys'

/** The deadline rule a column's settings name, if any */
export function ruleIdFromConfig(config: string | null | undefined): number | undefined {
  try {
    const id = (JSON.parse(config || '{}') as { alert_rule_id?: unknown }).alert_rule_id
    return typeof id === 'number' ? id : undefined
  } catch { return undefined }
}

/** The deadline rules the given columns use, each once, in column order */
export function rulesInUse(columns: Column[], rules: ParsedAlertRule[]): ParsedAlertRule[] {
  const seen = new Set<number>()
  const out: ParsedAlertRule[] = []
  for (const col of columns) {
    if (col.is_visible === 0 || !takesDeadlineRule(col.column_type)) continue
    const id = ruleIdFromConfig(col.config)
    if (id === undefined || seen.has(id)) continue
    const rule = rules.find(r => r.id === id)
    if (!rule) continue
    seen.add(id)
    out.push(rule)
  }
  return out
}

/** The key itself: each rule's colors with the shape its cells carry, and one line on how to read them */
export function DeadlineColorKey({ rules, columnNames }: { rules: ParsedAlertRule[]; columnNames?: Map<number, string[]> }): React.ReactElement {
  return (
    <div className="space-y-3">
      {rules.map(rule => {
        const cols = columnNames?.get(rule.id)
        return (
          <div key={rule.id}>
            <p className="text-base font-semibold text-slate-800 dark:text-slate-100">
              {rule.name}
              {cols && cols.length > 0 && <span className="font-normal text-slate-500 dark:text-slate-400"> · {cols.join(', ')}</span>}
            </p>
            <RuleColorKey rule={rule} compact shapes />
          </div>
        )
      })}
      <p className="text-sm text-slate-600 dark:text-slate-300">
        A cell's color and shape change as its date gets closer. Point at a cell to read how long is left.
      </p>
    </div>
  )
}

export interface ColorKeyPopoverProps {
  /** The rules to explain; nothing is shown when there are none */
  rules: ParsedAlertRule[]
  /** Which columns use each rule, shown after the rule's name */
  columnNames?: Map<number, string[]>
  /** The button's accessible name, and its tooltip */
  label: string
  /** Classes for the button (added to the link look when triggerVariant is 'link') */
  buttonClassName?: string
  /** Where the pop-up opens, relative to the button */
  placement?: 'below' | 'above'
  /** A sentence before the rules, e.g. what the dashboard's row stripes mean */
  intro?: string
  /** 'icon' (default): the caller styles the button and its label is the tooltip; 'link': underlined accent words */
  triggerVariant?: 'icon' | 'link'
  /** What the button shows */
  children: React.ReactNode
  'data-testid'?: string
}

const LINK_CLASS = 'hit-44 inline-flex items-center gap-1 text-base text-blue-700 dark:text-blue-300 underline hover:no-underline rounded-lg focus:outline-hidden focus-visible:ring-3 focus-visible:ring-accent'

const POPOVER_WIDTH = 340

/** A button that opens the color key in a pop-up beside it */
export function ColorKeyPopover({ rules, columnNames, label, buttonClassName, placement = 'below', intro, triggerVariant = 'icon', children, 'data-testid': testId }: ColorKeyPopoverProps): React.ReactElement {
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const onKeyDown = useMenuKeys(panelRef, open, () => setOpen(false), { kind: 'panel' })
  const [pos, setPos] = useState<{ top?: number; bottom?: number; left: number }>({ left: 8 })

  useLayoutEffect(() => {
    if (!open) return
    const rect = buttonRef.current?.getBoundingClientRect()
    if (!rect) return
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - POPOVER_WIDTH - 8))
    if (placement === 'above') setPos({ bottom: Math.max(8, window.innerHeight - rect.top + 6), left })
    else setPos({ top: rect.bottom + 6, left })
  }, [open, placement])

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={triggerVariant === 'link' ? `${LINK_CLASS} ${buttonClassName ?? ''}` : buttonClassName}
        aria-label={label}
        // A link shows its words; an icon gets them as a tooltip
        title={triggerVariant === 'icon' ? label : undefined}
        data-testid={testId}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={e => { e.stopPropagation(); setOpen(v => !v) }}
      >
        {children}
      </button>
      {open && createPortal(
        <>
          <div className="fixed inset-0 z-[9998]" onClick={() => setOpen(false)} />
          <div
            ref={panelRef}
            role="dialog"
            aria-label="What the colors mean"
            onKeyDown={onKeyDown}
            onClick={e => e.stopPropagation()}
            className="fixed z-[9999] bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg shadow-xl p-4 max-h-[80vh] overflow-y-auto"
            style={{ ...pos, width: POPOVER_WIDTH }}
          >
            <div className="flex items-start justify-between gap-2 mb-2">
              <h3 className="text-base font-semibold text-slate-800 dark:text-slate-100">What the colors mean</h3>
              <IconButton label="Close" size="compact" icon={<X className="w-4 h-4" />} onClick={() => setOpen(false)} className="-mr-2 -mt-2" />
            </div>
            {intro && <p className="mb-3 text-base text-slate-700 dark:text-slate-300">{intro}</p>}
            {rules.length > 0
              ? <DeadlineColorKey rules={rules} columnNames={columnNames} />
              : <p className="text-base text-slate-600 dark:text-slate-300">No date column here has a deadline rule yet.</p>}
          </div>
        </>, document.body
      )}
    </>
  )
}
