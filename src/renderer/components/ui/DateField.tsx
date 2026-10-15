/**
 * The one date box for typing a date (persona study R1, D1). It wraps the
 * native date input, so the calendar picker and the mm/dd/yyyy segments stay
 * as people know them, and adds what the native box doesn't do:
 *
 * 1. A half-typed or impossible date (02/30, a month with no day) is refused.
 *    The browser reports '' for it with validity.badInput set, which used to be
 *    saved as "no date" over the old one. Here Enter, Tab and leaving the box
 *    refuse it with a message under the box, and nothing is committed.
 * 2. A two-digit year is read as 20yy (80–99 as 19yy). "7/15/26" reaches the
 *    box as year 0026; on commit it becomes 2026, and the box shows it.
 * 3. A date is cleared only on purpose: every segment emptied (badInput is
 *    then false), never because the typing wasn't finished.
 * 4. At cell size, the date in words ("Wed, Mar 11, 2026") shows under the box
 *    as soon as it's whole, so a segment that jumped (31/13 → 03/11) is seen
 *    before Enter.
 *
 *   <DateField size="cell" value={v} onCommit={(v, how) => save(v, how)} onCancel={cancel} aria-label="IEP date" autoFocus />
 *   <label htmlFor={id}>Due date</label>
 *   <DateField id={id} value={due} onChange={(v, partial) => { setDue(v); setPartial(partial) }} />
 *
 * The box is uncontrolled while it has focus: writing a value into a native
 * date input rebuilds its segments, which would throw away the digits being
 * typed. A new `value` from the caller is written only when it differs from
 * what the box last reported.
 *
 * Words come from DATE_FIELD_TEXT; nothing here names a record or list.
 */
import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { MIN_YEAR, MAX_YEAR, normalizeTwoDigitYear, isCompleteDate } from '../../../shared/ymd'
import { shortYmd, ymdLocalDate } from '../../../shared/dates'
import { LAYER } from './layers'

export const DATE_FIELD_TEXT = {
  partial: "That isn't a whole date. Check the month, day and year.",
  year: `Use a year from ${MIN_YEAR} to ${MAX_YEAR}.`,
  required: 'Choose a date.',
} as const

/** "Read as 2026": what a two-digit year was taken to mean */
export function readAsText(year: number): string {
  return `Read as ${year}`
}

export type DateCommitHow = 'enter' | 'tab' | 'shift-tab' | 'blur'

/** What a date box holds right now */
export type DateReading =
  | { kind: 'empty' }
  /** readAs: the full year a two-digit year was read as, else null */
  | { kind: 'date'; value: string; readAs: number | null }
  | { kind: 'invalid'; message: string }

/** Reads a native date box's value and badInput flag */
export function readDateInput(raw: string, badInput: boolean): DateReading {
  if (badInput) return { kind: 'invalid', message: DATE_FIELD_TEXT.partial }
  if (raw === '') return { kind: 'empty' }
  const value = normalizeTwoDigitYear(raw)
  if (isCompleteDate(value, false)) return { kind: 'date', value, readAs: value !== raw ? Number(value.slice(0, 4)) : null }
  // A whole date in a year Pulse doesn't take (1850, a three-digit year mid-typing)
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return { kind: 'invalid', message: DATE_FIELD_TEXT.year }
  return { kind: 'invalid', message: DATE_FIELD_TEXT.partial }
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

/** A YYYY-MM-DD date in words: "Wed, Mar 11, 2026" */
export function dateInWords(ymd: string): string {
  return `${WEEKDAYS[ymdLocalDate(ymd).getDay()]}, ${shortYmd(ymd)}`
}

/** The box's own badInput flag (absent in test DOMs) */
function badInputOf(el: HTMLInputElement): boolean {
  return el.validity?.badInput === true
}

export interface DateFieldProps {
  ref?: React.Ref<HTMLInputElement>
  /** The stored date (YYYY-MM-DD), or null / '' for none */
  value: string | null
  /**
   * Enter, Tab or leaving the box with a whole date, or with every segment
   * emptied on purpose (null). Not called for a half-typed or impossible date.
   */
  onCommit?: (value: string | null, how: DateCommitHow) => void
  /** Every change: the date so far, or null with partial = true while it isn't whole */
  onChange?: (value: string | null, partial: boolean) => void
  /** A commit was refused; the message is already shown under the box */
  onInvalid?: (message: string, how: DateCommitHow) => void
  /** Escape. Without it, Escape is left to whatever holds the box (a dialog closes) */
  onCancel?: () => void
  /**
   * cell: fills a grid cell; Enter and Tab are the box's to handle and stay in it
   * when refused; the message and the date in words float under it.
   * field: a 44 px form box; the message sits under it in the form.
   */
  size?: 'cell' | 'field'
  /** An empty box may be committed (default true) */
  allowClear?: boolean
  /** Leaving the box for this element doesn't commit (a Clear button next to it) */
  ignoreBlurTo?: React.RefObject<HTMLElement | null>
  id?: string
  'aria-label'?: string
  'aria-describedby'?: string
  'aria-invalid'?: boolean
  min?: string
  max?: string
  autoFocus?: boolean
  disabled?: boolean
  className?: string
  style?: React.CSSProperties
  'data-testid'?: string
}

const CELL_CLASS = 'bg-white text-slate-800 dark:bg-slate-800 dark:text-slate-100'
const CELL_STYLE: React.CSSProperties = {
  width: '100%', height: '100%', border: 'none', outline: '3px solid #2563EB', outlineOffset: '-3px',
  padding: '0 4px 0 8px', fontSize: '15px', fontFamily: 'inherit', boxSizing: 'border-box',
}
const MESSAGE_CLASS = 'block text-base text-red-700 dark:text-red-300'

export function DateField({
  ref, value, onCommit, onChange, onInvalid, onCancel, size = 'field', allowClear = true, ignoreBlurTo,
  min = `${MIN_YEAR}-01-01`, max = `${MAX_YEAR}-12-31`, className, style,
  'aria-describedby': describedBy, 'aria-invalid': ariaInvalid, ...rest
}: DateFieldProps): React.ReactElement {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const initial = value || null
  // What the box last told its caller, so the caller's echo of it isn't written back into the box
  const reportedRef = useRef<string | null>(initial)
  const lastChangeRef = useRef<{ value: string | null; partial: boolean }>({ value: initial, partial: false })
  // The raw value of the last commit, so leaving the box right after Enter or Tab doesn't commit twice
  const committedRawRef = useRef<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [readAs, setReadAs] = useState<number | null>(null)
  const [whole, setWhole] = useState<string | null>(initial && isCompleteDate(initial, false) ? initial : null)
  const messageId = useId()
  const echoId = useId()

  const setRefs = (el: HTMLInputElement | null) => {
    inputRef.current = el
    if (typeof ref === 'function') ref(el)
    else if (ref) ref.current = el
  }

  // A new value from outside (a Clear button, a reset): show it
  useEffect(() => {
    const next = value || null
    const el = inputRef.current
    if (!el || next === reportedRef.current) return
    reportedRef.current = next
    lastChangeRef.current = { value: next, partial: false }
    el.value = next ?? ''
    setWhole(next && isCompleteDate(next, false) ? next : null)
    setMessage(null)
    setReadAs(null)
  }, [value])

  function report(next: string | null, partial: boolean) {
    const last = lastChangeRef.current
    if (last.value === next && last.partial === partial) return
    lastChangeRef.current = { value: next, partial }
    reportedRef.current = next
    onChange?.(next, partial)
  }

  /** After each keystroke or pick: what the box holds now */
  function evaluate(fromInput: boolean) {
    const el = inputRef.current
    if (!el) return
    const reading = readDateInput(el.value, badInputOf(el))
    committedRawRef.current = null
    if (reading.kind === 'date') {
      setWhole(reading.value)
      if (fromInput) setReadAs(reading.readAs)
      setMessage(null)
      report(reading.value, false)
    } else if (reading.kind === 'empty') {
      setWhole(null)
      if (fromInput) setReadAs(null)
      setMessage(null)
      report(null, false)
    } else {
      setWhole(null)
      if (fromInput) setReadAs(null)
      report(null, true)
    }
  }

  /** Enter, Tab or blur. False when refused (the message is shown) */
  function commit(how: DateCommitHow): boolean {
    const el = inputRef.current
    if (!el) return false
    const reading = readDateInput(el.value, badInputOf(el))
    if (reading.kind === 'invalid' || (reading.kind === 'empty' && !allowClear)) {
      const text = reading.kind === 'invalid' ? reading.message : DATE_FIELD_TEXT.required
      setMessage(text)
      report(null, reading.kind === 'invalid')
      onInvalid?.(text, how)
      return false
    }
    const next = reading.kind === 'date' ? reading.value : null
    if (reading.kind === 'date' && el.value !== reading.value) {
      // The year read as 20yy shows in the box, with the note under it
      el.value = reading.value
      setReadAs(reading.readAs)
    }
    setMessage(null)
    report(next, false)
    committedRawRef.current = el.value
    onCommit?.(next, how)
    return true
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape' && onCancel) {
      e.stopPropagation()
      onCancel()
    } else if (e.key === 'Enter' && !e.shiftKey) {
      if (!commit('enter')) { e.preventDefault(); e.stopPropagation() }
      else if (size === 'cell') e.stopPropagation()
    } else if (e.key === 'Tab' && size === 'cell') {
      // The cell's editor moves on itself; a refused date keeps focus here
      e.preventDefault()
      e.stopPropagation()
      commit(e.shiftKey ? 'shift-tab' : 'tab')
    }
  }

  function handleBlur(e: React.FocusEvent<HTMLInputElement>) {
    if (ignoreBlurTo?.current && e.relatedTarget === ignoreBlurTo.current) return
    if (committedRawRef.current !== null && committedRawRef.current === e.currentTarget.value) return
    commit('blur')
  }

  const showEcho = size === 'cell' && whole !== null && !message
  const invalid = message !== null || !!ariaInvalid
  const describedByIds = [describedBy, message ? messageId : null, showEcho || readAs !== null ? echoId : null].filter(Boolean).join(' ') || undefined

  const input = (
    <input
      {...rest}
      ref={setRefs}
      type="date"
      defaultValue={initial ?? ''}
      min={min}
      max={max}
      className={className ?? (size === 'cell' ? CELL_CLASS : 'input w-full')}
      style={style ?? (size === 'cell' ? CELL_STYLE : undefined)}
      aria-invalid={invalid || undefined}
      aria-describedby={describedByIds}
      onChange={() => evaluate(true)}
      onKeyUp={() => evaluate(false)}
      onKeyDown={handleKeyDown}
      onBlur={handleBlur}
    />
  )

  const messageNode = message ? <span id={messageId} role="alert" className={MESSAGE_CLASS}>{message}</span> : null
  const readAsNode = readAs !== null && !message ? readAsText(readAs) : null

  if (size === 'field') {
    return (
      <>
        {input}
        {messageNode && <span className="mt-1 block">{messageNode}</span>}
        {readAsNode && <span id={echoId} className="mt-1 block text-base text-slate-600 dark:text-slate-300">{readAsNode}</span>}
      </>
    )
  }

  return (
    <>
      {input}
      <FloatingNote anchor={inputRef} visible={!!messageNode || showEcho || !!readAsNode}>
        {messageNode}
        {showEcho && (
          <span id={echoId} className="block text-base text-slate-700 dark:text-slate-200" data-testid="date-echo">
            {dateInWords(whole)}{readAsNode ? `. ${readAsNode}` : ''}
          </span>
        )}
        {!showEcho && readAsNode && <span id={echoId} className="block text-base text-slate-700 dark:text-slate-200">{readAsNode}</span>}
      </FloatingNote>
    </>
  )
}

/**
 * The note under a cell-size box, drawn above the grid (a cell and the grid's
 * scroll area clip anything that sticks out of them). Below the box, or above
 * it near the window's bottom edge; it follows the box when the grid scrolls.
 */
function FloatingNote({ anchor, visible, children }: {
  anchor: React.RefObject<HTMLInputElement | null>
  visible: boolean
  children: React.ReactNode
}): React.ReactElement | null {
  const [place, setPlace] = useState<React.CSSProperties | null>(null)

  useLayoutEffect(() => {
    if (!visible) return
    const measure = () => {
      const r = anchor.current?.getBoundingClientRect()
      if (!r) return
      const below = r.bottom + 72 < window.innerHeight
      const next: React.CSSProperties = below
        ? { position: 'fixed', top: r.bottom + 4, left: r.left, minWidth: r.width }
        : { position: 'fixed', bottom: window.innerHeight - r.top + 4, left: r.left, minWidth: r.width }
      setPlace(prev => prev && prev.top === next.top && prev.bottom === next.bottom && prev.left === next.left && prev.minWidth === next.minWidth ? prev : next)
    }
    measure()
    window.addEventListener('resize', measure)
    document.addEventListener('scroll', measure, true)
    return () => {
      window.removeEventListener('resize', measure)
      document.removeEventListener('scroll', measure, true)
    }
  }, [visible, anchor])

  if (!visible) return null
  return createPortal(
    <div style={place ?? { position: 'fixed', visibility: 'hidden' }}
      className={`${LAYER.popover} pointer-events-none max-w-sm rounded-lg border border-slate-300 bg-white px-3 py-2 shadow-lg dark:border-slate-600 dark:bg-slate-800`}>
      {children}
    </div>,
    document.body,
  )
}
