/**
 * How big a zip file (an .xlsx) gets once unpacked, read from its central
 * directory without unpacking anything (Q-043). exceljs inflates the whole
 * workbook into memory, so a small file that unpacks to gigabytes (a "zip
 * bomb", or a sheet of a million repeated rows) could crash Pulse.
 */
import { open, type FileHandle } from 'fs/promises'

const EOCD_SIG = 0x06054b50
const CDIR_SIG = 0x02014b50
const ZIP64_EOCD_SIG = 0x06064b50
const ZIP64_LOCATOR_SIG = 0x07064b50
const ZIP64_EXTRA_ID = 0x0001
/** The end record is 22 bytes plus a comment of up to 65,535 */
const EOCD_SEARCH = 22 + 0xffff

/** An 8-byte size or offset; anything past 2^53 is far beyond any limit Pulse checks */
function u64(buf: Buffer, at: number): number {
  return Number(buf.readBigUInt64LE(at))
}

async function readAt(fh: FileHandle, at: number, len: number): Promise<Buffer> {
  const buf = Buffer.alloc(len)
  await fh.read(buf, 0, len, at)
  return buf
}

/**
 * Total uncompressed size of every entry, in bytes. ZIP64 zips (which some
 * writers use even for small files, R1-02) are read through their ZIP64 end
 * record and each entry's ZIP64 extra field. null when the file isn't a
 * readable zip (exceljs then reports its own error).
 */
export async function zipUncompressedSize(filePath: string): Promise<number | null> {
  const fh = await open(filePath, 'r')
  try {
    const { size } = await fh.stat()
    if (size < 22) return null
    const tailLen = Math.min(size, EOCD_SEARCH)
    const tailStart = size - tailLen
    const tail = await readAt(fh, tailStart, tailLen)
    let eocd = -1
    for (let i = tailLen - 22; i >= 0; i--) {
      if (tail.readUInt32LE(i) === EOCD_SIG) { eocd = i; break }
    }
    if (eocd < 0) return null
    let entries = tail.readUInt16LE(eocd + 10)
    let cdSize = tail.readUInt32LE(eocd + 12)
    let cdOffset = tail.readUInt32LE(eocd + 16)
    if (entries === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
      // ZIP64: the 20-byte locator sits just before the end record and points at the ZIP64 end record
      const locAt = tailStart + eocd - 20
      if (locAt < 0) return null
      const loc = await readAt(fh, locAt, 20)
      if (loc.readUInt32LE(0) !== ZIP64_LOCATOR_SIG) return null
      const z64At = u64(loc, 8)
      if (z64At + 56 > size) return null
      const z64 = await readAt(fh, z64At, 56)
      if (z64.readUInt32LE(0) !== ZIP64_EOCD_SIG) return null
      entries = u64(z64, 32)
      cdSize = u64(z64, 40)
      cdOffset = u64(z64, 48)
    }
    if (cdOffset + cdSize > size) return null
    const cd = await readAt(fh, cdOffset, cdSize)
    let total = 0
    let p = 0
    for (let n = 0; n < entries; n++) {
      if (p + 46 > cd.length || cd.readUInt32LE(p) !== CDIR_SIG) return null
      let uncompressed = cd.readUInt32LE(p + 24)
      const nameLen = cd.readUInt16LE(p + 28)
      const extraLen = cd.readUInt16LE(p + 30)
      if (p + 46 + nameLen + extraLen > cd.length) return null
      if (uncompressed === 0xffffffff) {
        // The real size is the first field of the ZIP64 extra field. Without one, 0xffffffff
        // is the size itself (4 GB), which is over any limit anyway.
        const extraEnd = p + 46 + nameLen + extraLen
        for (let x = p + 46 + nameLen; x + 4 <= extraEnd;) {
          const id = cd.readUInt16LE(x)
          const len = cd.readUInt16LE(x + 2)
          if (id === ZIP64_EXTRA_ID && len >= 8 && x + 12 <= extraEnd) { uncompressed = u64(cd, x + 4); break }
          x += 4 + len
        }
      }
      total += uncompressed
      p += 46 + nameLen + extraLen + cd.readUInt16LE(p + 32)
    }
    return total
  } finally {
    await fh.close()
  }
}
