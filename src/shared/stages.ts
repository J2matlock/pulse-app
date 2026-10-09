/**
 * Stages and the board (generalization W06): one status or dropdown column
 * per list can be "the stage". Its options, in order, are the board's
 * columns; each can count as done and do things when a record enters it.
 */
import { z } from 'zod'
import { ACTIVITY_COLORS } from './activityTypes'

const color = z.union([z.enum(ACTIVITY_COLORS), z.string().regex(/^#[0-9a-fA-F]{6}$/)])

export const stageOptionSchema = z.object({
  /** Matches the column's option */
  value: z.string().trim().min(1).max(200),
  color: color.optional(),
  /** Counts as finished: left out of "open" counts; the board can hide old ones */
  done: z.boolean().optional(),
  onEnter: z.object({
    /** Add this checklist to the record */
    checklistTemplateId: z.number().int().positive().optional(),
    /** Set this date column to today ("Picked up on"), which can start deadlines */
    stampColumnId: z.number().int().positive().optional(),
    /** Log a note of this type: "Moved to Ready" */
    activityTypeKey: z.string().regex(/^[a-z0-9_]{1,30}$/).optional(),
  }).strict().optional(),
}).strict()

export const stageConfigSchema = z.object({
  options: z.array(stageOptionSchema).min(1).max(30),
  /** The board hides cards that have been done for longer than this (days) */
  hideDoneAfterDays: z.number().int().min(0).max(3650).optional(),
}).strict()

export type StageOption = z.infer<typeof stageOptionSchema>
export type StageConfig = z.infer<typeof stageConfigSchema>

export const DEFAULT_HIDE_DONE_DAYS = 14

/** Column types that can be the stage */
export function canBeStage(columnType: string): boolean {
  return columnType === 'status' || columnType === 'dropdown'
}

/** The stage settings in a column's config, if it is the stage and they're readable. */
export function stageConfigOf(column: { column_type: string; config: string | null }): StageConfig | null {
  if (!canBeStage(column.column_type)) return null
  try {
    const parsed = stageConfigSchema.safeParse((JSON.parse(column.config || '{}') as { stage?: unknown }).stage)
    return parsed.success ? parsed.data : null
  } catch { return null }
}

/** The list's stage column, if it has one */
export function stageColumnOf<C extends { column_type: string; config: string | null }>(columns: C[]): C | null {
  return columns.find(c => stageConfigOf(c) !== null) ?? null
}

/** A status or dropdown column's option labels, in order */
export function columnOptionLabels(column: { column_type: string; config: string | null }): string[] {
  try {
    const opts = (JSON.parse(column.config || '{}') as { options?: Array<string | { label?: string }> }).options ?? []
    return opts.map(o => typeof o === 'string' ? o : o?.label ?? '').filter(Boolean)
  } catch { return [] }
}

/** What STAGE_MOVE changed, so one undo step can put it all back */
export interface StageMoveResult {
  /** The stage before, for undo; unchanged moves change nothing */
  previous: string | null
  changed: boolean
  /** Notes written (the change note and an on-enter note), voided on undo */
  sysLogIds: number[]
  checklistItemIds: number[]
  /** A date column filled in on entering, and what it held */
  stamped: { columnId: number; previous: string | null } | null
}

/** Time in stage for one record (W06 §5), from the stage column's history */
export interface StageDurations {
  current: {
    stage: string | null
    /** UTC timestamp as stored */
    since: string
    days: number
    /** No history yet: counted from when the record was added */
    approximate: boolean
  }
  /** Finished stays, oldest first */
  stays: Array<{ stage: string | null; from: string; to: string; days: number; approximate: boolean }>
}

/** Dashboard "Stages" card (W06 §6), one entry per list with a stage */
export interface StageSummary {
  gridId: number
  gridName: string
  columnId: number
  columnName: string
  stages: Array<{ value: string; color?: string; done: boolean; count: number; avgDays: number | null }>
  noStage: number
  /** The open record that has been in its stage longest */
  oldest: { rowId: number; name: string; stage: string; days: number; approximate: boolean } | null
}

/** A stage in starters and shared files (W06 §8): checklist and date column by name */
export const portableStageSchema = z.object({
  options: z.array(z.object({
    value: z.string().trim().min(1).max(200),
    color: z.string().max(20).optional(),
    done: z.boolean().optional(),
    onEnter: z.object({
      checklist: z.string().trim().min(1).max(200).optional(),
      stampColumn: z.string().trim().min(1).max(200).optional(),
      activityType: z.string().regex(/^[a-z0-9_]{1,30}$/).optional(),
    }).strict().optional(),
  }).strict()).min(1).max(30),
  hideDoneAfterDays: z.number().int().min(0).max(3650).optional(),
}).strict()

export type PortableStage = z.infer<typeof portableStageSchema>
