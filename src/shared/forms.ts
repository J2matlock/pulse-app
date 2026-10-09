/**
 * Forms (generalization W08): fields, settings and validation, shared by
 * main and the window.
 */
import { z } from 'zod'

export const MAX_FORM_FIELDS = 80

export const formFieldSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('column'),
    columnId: z.number().int().positive(),
    label: z.string().trim().max(200).optional(),
    help: z.string().trim().max(500).optional(),
    required: z.boolean().optional(),
    width: z.enum(['full', 'half']).optional(),
  }).strict(),
  z.object({
    kind: z.literal('section'),
    title: z.string().trim().min(1).max(200),
    text: z.string().trim().max(1000).optional(),
  }).strict(),
  z.object({
    kind: z.literal('note'),
    label: z.string().trim().min(1).max(200),
    help: z.string().trim().max(500).optional(),
    required: z.boolean().optional(),
  }).strict(),
])
export type FormField = z.infer<typeof formFieldSchema>

export const formInputSchema = z.object({
  id: z.number().int().positive().optional(),
  grid_id: z.number().int().positive(),
  name: z.string().trim().min(1).max(200),
  intro: z.string().trim().max(2000).nullable().optional(),
  fields: z.array(formFieldSchema).min(1).max(MAX_FORM_FIELDS),
  log_activity_type: z.string().regex(/^[a-z0-9_]{1,30}$/).nullable().optional(),
}).strict()
export type FormInput = z.input<typeof formInputSchema>

export interface Form {
  id: number
  grid_id: number
  name: string
  intro: string | null
  fields: FormField[]
  log_activity_type: string | null
  position: number
  created_at: string
  updated_at: string
  /** Fields whose column no longer exists, dropped when the form was read */
  dropped?: number
}

/** Column types a form can't fill (Pulse fills them, or they show a rule) */
export const NOT_FILLABLE = new Set(['auto_number', 'age_from_dob', 'calculated_days', 'deadline', 'file_count'])

/** What a form submit changed, so one undo step can put it back */
export interface FormChange {
  rowId: number
  /** The record was made by this submit */
  created: boolean
  /** Column id → value before (updates only) */
  previous: Record<number, string | null>
  /** Link column id → linked record ids before (updates only) */
  previousLinks: Record<number, number[]>
  noteId: number | null
}
