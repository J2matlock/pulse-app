import { isNotTypedColumnType, type Column } from '../../shared/types'

/**
 * A typed-in column with nothing in it. Worked-out columns (age, days, links,
 * file counts) always have something to show, so they never count as empty.
 * Shared by the record page's details block and its "(4 filled)" title.
 */
export function isEmptyCell(col: Pick<Column, 'column_type'>, value: string | null | undefined): boolean {
  return (value == null || value === '') && !isNotTypedColumnType(col.column_type)
}
