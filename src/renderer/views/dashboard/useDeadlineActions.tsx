/**
 * The one set of deadline actions (UX D-08): Done (which asks for a reading,
 * or Renewed/Finished, when the rule needs it), Done on…, Extend… and
 * Remove extension, with their dialogs. The shared deadline card
 * (components/deadlines/DeadlineCardContent) renders them on the grid, the
 * profile, the Calendar and the dashboard, so a deadline behaves the same
 * wherever it's shown.
 */
import React, { useState } from 'react'
import { completeDeadlines, startsNextCycle, isOneOffDeadline } from './completeDeadline'
import { OneOffDoneDialog, type OneOffChoice } from './OneOffDoneDialog'
import { hasInterval, toRuleInterval, type RuleInterval } from '../../../shared/ruleInterval'
import type { ExtendedDeadlineInfo } from './types'
import { MeterReadingDialog } from './MeterReadingDialog'
import { DoneOnDayDialog } from './DoneOnDayDialog'
import { ExtendDeadlineDialog } from './ExtendDeadlineDialog'
import { extendDeadline, removeExtension } from './extendDeadline'
import type { RuleKind } from '../../../shared/deadlineEngine'

/** What a deadline's rule allows, worked out from the deadline alone (no state) */
export interface DeadlineTraits {
  ruleKind: RuleKind
  ruleInterval: RuleInterval
  /** A date that doesn't repeat: Done asks Renewed or Finished (Decision E1) */
  oneOff: boolean
  /** The due date counts from the date in this column ("last done …") */
  recurring: boolean
  /** "IFSP meeting (step 1 of 4)" → "IFSP meeting" */
  stepName: string | null
  /** What Done will do, for a tooltip */
  doneTitle: string
  /** Done on… applies: not a quota (renewed on the record), a meter (its dialog asks) or a one-off */
  canPickDay: boolean
  /** Done applies: something is due, it isn't finished or paused, and it isn't a quota (renewed on the record) */
  canMarkDone: boolean
  /** Extend… applies: something is due and it isn't finished or paused */
  canExtend: boolean
}

export interface DeadlineActions extends DeadlineTraits {
  marking: boolean
  /** Done, or the question Done needs answered first */
  startDone: () => void
  startDoneOnDay: () => void
  startExtend: () => void
  removeExtension: () => Promise<boolean>
  /** Render these once, anywhere in the tree */
  dialogs: React.ReactNode
}

export function deadlineTraits(deadline: ExtendedDeadlineInfo): DeadlineTraits {
  const ruleInterval = deadline.interval ?? toRuleInterval(deadline.intervalDays)
  const ruleKind = deadline.ruleKind ?? 'interval'
  const oneOff = isOneOffDeadline({ ruleKind, interval: ruleInterval })
  const recurring = ruleKind === 'interval' && hasInterval(ruleInterval)
  const stepName = ruleKind === 'sequence' && deadline.label ? deadline.label.replace(/ \((step|repeat) [^)]*\)$/, '') : null
  const canPickDay = ruleKind !== 'quota' && ruleKind !== 'meter' && !oneOff
  const live = deadline.state !== 'done' && deadline.state !== 'paused' && (!!deadline.due || typeof deadline.daysUntil === 'number')
  const doneTitle = ruleKind === 'meter' ? 'Mark done: asks for the current reading'
    : ruleKind === 'sequence' ? 'Mark this step done; the next step comes due'
    : ruleKind !== 'interval' ? 'Mark done: saves today as the day it was done'
    : startsNextCycle(ruleInterval)
    ? 'Mark done: sets the date to today, which starts the next cycle'
    : 'Mark done: asks whether it was renewed (a new date) or finished'
  return { ruleKind, ruleInterval, oneOff, recurring, stepName, doneTitle, canPickDay, canMarkDone: live && ruleKind !== 'quota', canExtend: live }
}

export function useDeadlineActions(deadline: ExtendedDeadlineInfo, opts: {
  /** After Done went through: drop the row */
  onMarkDone?: (rowId: number, columnId: number) => void
  /** After Undo, or an extension changed: reload */
  onChanged?: () => Promise<void>
}): DeadlineActions {
  const [marking, setMarking] = useState(false)
  const [askReading, setAskReading] = useState(false)
  const [askOneOff, setAskOneOff] = useState(false)
  const [askDay, setAskDay] = useState(false)
  const [extending, setExtending] = useState(false)
  const { clientName, columnName, dateValue, rowId, columnId, gridId } = deadline
  const traits = deadlineTraits(deadline)
  const { ruleInterval, ruleKind, oneOff, stepName } = traits

  async function markDone(reading?: number, doneOn?: string, choice?: OneOffChoice) {
    setMarking(true)
    try {
      const done = await completeDeadlines([{ rowId, columnId, columnName, clientName, dateValue, interval: ruleInterval, checklistTemplateId: deadline.checklistTemplateId, ruleKind, reading, step: deadline.step, doneOn, oneOff: choice }], { onUndone: opts.onChanged })
      if (done.length > 0) opts.onMarkDone?.(rowId, columnId)
    } finally {
      setMarking(false)
    }
  }

  const dialogs = (
    <>
      {extending && (
        <ExtendDeadlineDialog title={`${columnName}: ${clientName}`} currentDue={deadline.due ?? null} gridId={gridId} onClose={() => setExtending(false)}
          onSave={(newDue, reason) => { setExtending(false); void extendDeadline(rowId, columnId, columnName, newDue, reason, opts.onChanged) }} />
      )}
      {askOneOff && (
        <OneOffDoneDialog title={`${columnName}: ${clientName}`} currentDue={deadline.due ?? null} onClose={() => setAskOneOff(false)}
          onSave={choice => { setAskOneOff(false); void markDone(undefined, undefined, choice) }} />
      )}
      {askReading && (
        <MeterReadingDialog title={`${columnName}: ${clientName}`} info={deadline.meter} onClose={() => setAskReading(false)}
          onSave={(reading, doneOn) => { setAskReading(false); void markDone(reading, doneOn) }} />
      )}
      {askDay && (
        <DoneOnDayDialog title={`Mark ${stepName ?? columnName} done for ${clientName}`} onClose={() => setAskDay(false)}
          onSave={day => { setAskDay(false); void markDone(undefined, day) }} />
      )}
    </>
  )

  return {
    ...traits,
    marking,
    startDone: () => { if (ruleKind === 'meter') setAskReading(true); else if (oneOff) setAskOneOff(true); else void markDone() },
    startDoneOnDay: () => setAskDay(true),
    startExtend: () => setExtending(true),
    removeExtension: () => deadline.extensionId ? removeExtension(deadline.extensionId, columnName, opts.onChanged) : Promise.resolve(false),
    dialogs,
  }
}
