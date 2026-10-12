/**
 * How big a zip file (an .xlsx) gets once unpacked, read from its central
 * directory without unpacking anything (Q-043). exceljs inflates the whole
 * workbook into memory, so a small file that unpacks to gigabytes (a "zip
 * bomb", or a sheet of a million repeated rows) could crash Pulse.
 */
import { open } from 'fs/promises'

const EOCD_SIG = 0x06054b50
const CDIR_SIG = 0x02014b50
/** The end record is 22 bytes plus a comment of up to 65,535 */
const EOCD_SEARCH = 22 + 0xffff

/**
 * Total uncompressed size of every entry, in bytes; Infinity when an entry
 * needs ZIP64 sizes (over 4 GB) or there are too many entries to list. null
 * when the file isn't a readable zip (exceljs then reports its own error).
 */
export async function zipUncompressedSize(filePath: string): Promise<number | null> {
  const fh = await open(filePath, 'r')
  try {
    const { size } = await fh.stat()
    if (size < 22) return null
    const tailLen = Math.min(size, EOCD_SEARCH)
    const tail = Buffer.alloc(tailLen)
    await fh.read(tail, 0, tailLen, size - tailLen)
    let eocd = -1
    for (let i = tailLen - 22; i >= 0; i--) {
      if (tail.readUInt32LE(i) === EOCD_SIG) { eocd = i; break }
    }
    if (eocd < 0) return null
    const entries = tail.readUInt16LE(eocd + 10)
    const cdSize = tail.readUInt32LE(eocd + 12)
    const cdOffset = tail.readUInt32LE(eocd + 16)
    if (entries === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) return Infinity
    if (cdOffset + cdSize > size) return null
    const cd = Buffer.alloc(cdSize)
    await fh.read(cd, 0, cdSize, cdOffset)
    let total = 0
    let p = 0
    for (let n = 0; n < entries; n++) {
      if (p + 46 > cd.length || cd.readUInt32LE(p) !== CDIR_SIG) return null
      const uncompressed = cd.readUInt32LE(p + 24)
      if (uncompressed === 0xffffffff) return Infinity
      total += uncompressed
      p += 46 + cd.readUInt16LE(p + 28) + cd.readUInt16LE(p + 30) + cd.readUInt16LE(p + 32)
    }
    return total
  } finally {
    await fh.close()
  }
}
