/** zipUncompressedSize reads an .xlsx's unpacked size from its central directory (Q-043). */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import ExcelJS from 'exceljs'
import { zipUncompressedSize } from '../src/main/zip-size'
import { fakeZip } from './zipFixture'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'pulse-zipsize-')) })
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('zipUncompressedSize', () => {
  it('reads the size a zip claims once unpacked', async () => {
    const p = join(dir, 'bomb.xlsx')
    writeFileSync(p, fakeZip(3_000_000_000))
    expect(await zipUncompressedSize(p)).toBe(3_000_000_000)
  })

  it('adds up the entries of a real workbook', async () => {
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('S')
    for (let i = 0; i < 200; i++) ws.addRow([`Person ${i}`, 'Some repeated text for size'])
    const p = join(dir, 'real.xlsx')
    await wb.xlsx.writeFile(p)
    const size = await zipUncompressedSize(p)
    expect(size).toBeGreaterThan(5_000)
    expect(size).toBeLessThan(1_000_000)
  })

  it('says null for something that is not a zip', async () => {
    const p = join(dir, 'not.xlsx')
    writeFileSync(p, 'Name,Phone\nAna,555\n')
    expect(await zipUncompressedSize(p)).toBeNull()
  })
})
