/**
 * export-shared.ts pure helpers: the CSV formula guard on every column type,
 * PDF display text without the CSV guard, and rich text to plain text.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('../src/main/database', () => ({
  getDb: () => { throw new Error('no database in this test') },
  cachedStmt: () => { throw new Error('no database in this test') },
  buildGridQuery: () => '',
}))
vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => '/tmp/pulse-test-export-shared', commandLine: { appendSwitch: () => {} } },
  safeStorage: { isEncryptionAvailable: () => false, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() },
  dialog: { showMessageBoxSync: () => 0 },
}))

import { formatCellValue, cellDisplayText } from '../src/main/export-shared'

const NON_TEXT = ['number', 'currency', 'date', 'checkbox', 'auto_number', 'age_from_dob', 'calculated_days', 'file_count']

describe('formatCellValue formula guard (AUDIT-008)', () => {
  for (const type of NON_TEXT.filter(t => t !== 'checkbox')) {
    it(`neutralizes a formula stored in a ${type} column`, () => {
      expect(formatCellValue('=HYPERLINK("http://x","click")', type, 'iso')).toBe('\t=HYPERLINK("http://x","click")')
      expect(formatCellValue('@SUM(1)', type, 'iso')).toBe('\t@SUM(1)')
      expect(formatCellValue('+cmd|x', type, 'iso')).toBe('\t+cmd|x')
    })
  }

  it('leaves genuine numbers, negative numbers and dates alone', () => {
    expect(formatCellValue('-12.50', 'number', 'iso')).toBe('-12.50')
    expect(formatCellValue('-1,234.5', 'number', 'iso')).toBe('-1,234.5')
    expect(formatCellValue('1e3', 'number', 'iso')).toBe('1e3')
    expect(formatCellValue('-12.5', 'currency', 'iso')).toBe('$-12.50')
    expect(formatCellValue('2026-10-06', 'date', 'iso')).toBe('2026-10-06')
    expect(formatCellValue('2026-10-06', 'date', 'us')).toBe('10/06/2026')
    expect(formatCellValue('1', 'checkbox', 'iso')).toBe('Yes')
    expect(formatCellValue('7', 'auto_number', 'iso')).toBe('7')
  })

  it('still guards text columns, including a negative-looking text value', () => {
    expect(formatCellValue('-12', 'text', 'iso')).toBe('\t-12')
    expect(formatCellValue('=1+2', 'text', 'iso')).toBe('\t=1+2')
  })
})

describe('cellDisplayText for PDFs (AUDIT-121)', () => {
  it('never adds the CSV tab prefix', () => {
    expect(cellDisplayText('+1 555 0100', 'phone', 'iso')).toBe('+1 555 0100')
    expect(cellDisplayText('- follow up', 'text', 'iso')).toBe('- follow up')
    expect(cellDisplayText('2026-10-06', 'date', 'us')).toBe('10/06/2026')
  })
})
