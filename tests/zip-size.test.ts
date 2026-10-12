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

  // R1-02: some writers (streaming, .NET packaging, Java) use ZIP64 records for small files
  it('reads the real sizes of a ZIP64 zip instead of refusing it', async () => {
    const p = join(dir, 'zip64.xlsx')
    writeFileSync(p, zip64([{ name: 'a.xml', data: Buffer.from('hello') }, { name: 'b.xml', data: Buffer.alloc(1000, 120) }]))
    expect(await zipUncompressedSize(p)).toBe(1005)
  })

  it('still sees a ZIP64 zip that claims a huge unpacked size', async () => {
    const p = join(dir, 'zip64-bomb.xlsx')
    writeFileSync(p, zip64([{ name: 'a.xml', data: Buffer.from('x'), claim: 3_000_000_000 }]))
    expect(await zipUncompressedSize(p)).toBe(3_000_000_000)
  })

  it('a ZIP64 end record pointing outside the file is not a readable zip', async () => {
    const bytes = zip64([{ name: 'a.xml', data: Buffer.from('x') }])
    // The locator's offset of the ZIP64 end record (20-byte locator, then the 22-byte end record)
    bytes.writeBigUInt64LE(10_000_000n, bytes.length - 22 - 20 + 8)
    const p = join(dir, 'zip64-bad.xlsx')
    writeFileSync(p, bytes)
    expect(await zipUncompressedSize(p)).toBeNull()
  })
})

/** A stored (uncompressed) zip that uses ZIP64 records throughout, as streaming writers do */
function zip64(entries: Array<{ name: string; data: Buffer; claim?: number }>): Buffer {
  const parts: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  for (const e of entries) {
    const name = Buffer.from(e.name)
    const extra = Buffer.alloc(20)
    extra.writeUInt16LE(0x0001, 0); extra.writeUInt16LE(16, 2)
    extra.writeBigUInt64LE(BigInt(e.claim ?? e.data.length), 4)
    extra.writeBigUInt64LE(BigInt(e.data.length), 12)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(45, 4)
    local.writeUInt32LE(0xffffffff, 18); local.writeUInt32LE(0xffffffff, 22)
    local.writeUInt16LE(name.length, 26); local.writeUInt16LE(extra.length, 28)
    parts.push(local, name, extra, e.data)
    const cd = Buffer.alloc(46)
    cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(45, 4); cd.writeUInt16LE(45, 6)
    cd.writeUInt32LE(0xffffffff, 20); cd.writeUInt32LE(0xffffffff, 24)
    cd.writeUInt16LE(name.length, 28); cd.writeUInt16LE(extra.length, 30)
    cd.writeUInt32LE(offset, 42)
    central.push(cd, name, extra)
    offset += 30 + name.length + extra.length + e.data.length
  }
  const cdBuf = Buffer.concat(central)
  const z64 = Buffer.alloc(56)
  z64.writeUInt32LE(0x06064b50, 0); z64.writeBigUInt64LE(44n, 4); z64.writeUInt16LE(45, 12); z64.writeUInt16LE(45, 14)
  z64.writeBigUInt64LE(BigInt(entries.length), 24); z64.writeBigUInt64LE(BigInt(entries.length), 32)
  z64.writeBigUInt64LE(BigInt(cdBuf.length), 40); z64.writeBigUInt64LE(BigInt(offset), 48)
  const loc = Buffer.alloc(20)
  loc.writeUInt32LE(0x07064b50, 0); loc.writeBigUInt64LE(BigInt(offset + cdBuf.length), 8); loc.writeUInt32LE(1, 16)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(0xffff, 8); eocd.writeUInt16LE(0xffff, 10)
  eocd.writeUInt32LE(0xffffffff, 12); eocd.writeUInt32LE(0xffffffff, 16)
  return Buffer.concat([...parts, cdBuf, z64, loc, eocd])
}
