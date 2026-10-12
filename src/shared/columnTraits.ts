/**
 * Every column type and what it allows, in one table (A211-01). A new type
 * has to say what it does here, or nothing compiles; the predicates in
 * types.ts and the lists in columnTypes.ts, forms.ts, export-shared.ts,
 * missing-info.ts, links.ts and templates.ts all read this table.
 */

export const COLUMN_TYPES = [
  'text', 'date', 'number', 'checkbox', 'dropdown',
  'phone', 'email', 'tag', 'currency', 'url',
  'notes', 'status', 'address', 'age_from_dob', 'calculated_days', 'auto_number', 'deadline', 'link', 'file_count',
] as const

export type ColumnType = typeof COLUMN_TYPES[number]

export interface ColumnTraits {
  /** Pulse works the value out (age, days until, auto number); nobody types or pastes into it */
  readOnly: boolean
  /** Has a box to type in. Deadlines show their rule's status, links and file counts come from other tables */
  typed: boolean
  /** Keeps its values in the cells table (links and file counts are worked out from other tables) */
  storesCells: boolean
  /** Can name a list's records ("Use as name") */
  canName: boolean
  /** An import can fill it (values mapped to a worked-out column would vanish) */
  importable: boolean
  /** A deadline rule can be attached to it */
  takesRule: boolean
  /** Change type works to and from it: it stores what people type */
  changeable: boolean
  /** A form can fill it */
  formFillable: boolean
  /** Its text is a number or a date, so a leading "-" in an export is a sign, not a formula (X-21) */
  numericText: boolean
  /** Can be marked required (Missing info) */
  requirable: boolean
  /** One of the details shown under a linked record */
  linkDetail: boolean
  /** A .pulse template can carry it */
  inTemplates: boolean
}

const T = true
const F = false

export const COLUMN_TRAITS: Record<ColumnType, ColumnTraits> = {
  text:            { readOnly: F, typed: T, storesCells: T, canName: T, importable: T, takesRule: F, changeable: T, formFillable: T, numericText: F, requirable: T, linkDetail: T, inTemplates: T },
  date:            { readOnly: F, typed: T, storesCells: T, canName: T, importable: T, takesRule: T, changeable: T, formFillable: T, numericText: T, requirable: T, linkDetail: T, inTemplates: T },
  number:          { readOnly: F, typed: T, storesCells: T, canName: T, importable: T, takesRule: F, changeable: T, formFillable: T, numericText: T, requirable: T, linkDetail: T, inTemplates: T },
  checkbox:        { readOnly: F, typed: T, storesCells: T, canName: F, importable: T, takesRule: F, changeable: T, formFillable: T, numericText: T, requirable: F, linkDetail: F, inTemplates: T },
  dropdown:        { readOnly: F, typed: T, storesCells: T, canName: T, importable: T, takesRule: F, changeable: T, formFillable: T, numericText: F, requirable: T, linkDetail: T, inTemplates: T },
  phone:           { readOnly: F, typed: T, storesCells: T, canName: T, importable: T, takesRule: F, changeable: T, formFillable: T, numericText: F, requirable: T, linkDetail: T, inTemplates: T },
  email:           { readOnly: F, typed: T, storesCells: T, canName: T, importable: T, takesRule: F, changeable: T, formFillable: T, numericText: F, requirable: T, linkDetail: T, inTemplates: T },
  tag:             { readOnly: F, typed: T, storesCells: T, canName: T, importable: T, takesRule: F, changeable: T, formFillable: T, numericText: F, requirable: T, linkDetail: T, inTemplates: T },
  currency:        { readOnly: F, typed: T, storesCells: T, canName: T, importable: T, takesRule: F, changeable: T, formFillable: T, numericText: T, requirable: T, linkDetail: T, inTemplates: T },
  url:             { readOnly: F, typed: T, storesCells: T, canName: T, importable: T, takesRule: F, changeable: T, formFillable: T, numericText: F, requirable: T, linkDetail: T, inTemplates: T },
  notes:           { readOnly: F, typed: T, storesCells: T, canName: F, importable: T, takesRule: F, changeable: T, formFillable: T, numericText: F, requirable: T, linkDetail: F, inTemplates: T },
  status:          { readOnly: F, typed: T, storesCells: T, canName: T, importable: T, takesRule: F, changeable: T, formFillable: T, numericText: F, requirable: T, linkDetail: T, inTemplates: T },
  address:         { readOnly: F, typed: T, storesCells: T, canName: T, importable: T, takesRule: F, changeable: T, formFillable: T, numericText: F, requirable: T, linkDetail: T, inTemplates: T },
  age_from_dob:    { readOnly: T, typed: F, storesCells: T, canName: F, importable: F, takesRule: F, changeable: F, formFillable: F, numericText: T, requirable: F, linkDetail: F, inTemplates: T },
  calculated_days: { readOnly: T, typed: F, storesCells: T, canName: F, importable: F, takesRule: F, changeable: F, formFillable: F, numericText: T, requirable: F, linkDetail: F, inTemplates: T },
  // Imported numbers are kept and numbering carries on after the highest
  auto_number:     { readOnly: T, typed: F, storesCells: T, canName: T, importable: T, takesRule: F, changeable: F, formFillable: F, numericText: T, requirable: F, linkDetail: T, inTemplates: T },
  // Its cell holds the date it was last done, which marking a deadline done writes
  deadline:        { readOnly: F, typed: F, storesCells: T, canName: F, importable: T, takesRule: T, changeable: F, formFillable: F, numericText: F, requirable: F, linkDetail: F, inTemplates: T },
  link:            { readOnly: F, typed: F, storesCells: F, canName: F, importable: T, takesRule: F, changeable: F, formFillable: T, numericText: F, requirable: F, linkDetail: F, inTemplates: F },
  file_count:      { readOnly: F, typed: F, storesCells: F, canName: F, importable: F, takesRule: F, changeable: F, formFillable: F, numericText: T, requirable: F, linkDetail: T, inTemplates: T },
}

/** A column_type read from the database or a file that this version doesn't know: treated as plain text it can't change or export */
const UNKNOWN_TRAITS: ColumnTraits = { ...COLUMN_TRAITS.text, changeable: F, inTemplates: F }

export function isColumnType(type: string): type is ColumnType {
  return Object.prototype.hasOwnProperty.call(COLUMN_TRAITS, type)
}

export function columnTraits(type: string): ColumnTraits {
  return isColumnType(type) ? COLUMN_TRAITS[type] : UNKNOWN_TRAITS
}

/** The types with a trait, in COLUMN_TYPES order */
export function columnTypesWhere(test: (t: ColumnTraits) => boolean): ColumnType[] {
  return COLUMN_TYPES.filter(type => test(COLUMN_TRAITS[type]))
}

/** The same list for a SQL `IN (…)`: fixed type names, quoted */
export function columnTypesSql(test: (t: ColumnTraits) => boolean): string {
  return columnTypesWhere(test).map(type => `'${type}'`).join(', ')
}
