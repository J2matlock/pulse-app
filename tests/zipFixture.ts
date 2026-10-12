/** Zip files for import size tests (Q-043), built by hand so nothing has to be unpacked. */
/** A one-entry zip whose central directory claims `claimed` bytes unpacked */
export function fakeZip(claimed: number, name = 'xl/worksheets/sheet1.xml'): Buffer {
  const fname = Buffer.from(name)
  const data = Buffer.from('x')
  const local = Buffer.alloc(30)
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt32LE(1, 18); local.writeUInt32LE(claimed, 22); local.writeUInt16LE(fname.length, 26)
  const cd = Buffer.alloc(46)
  cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt32LE(1, 20); cd.writeUInt32LE(claimed, 24); cd.writeUInt16LE(fname.length, 28)
  const cdOffset = local.length + fname.length + data.length
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(1, 8); eocd.writeUInt16LE(1, 10)
  eocd.writeUInt32LE(cd.length + fname.length, 12); eocd.writeUInt32LE(cdOffset, 16)
  return Buffer.concat([local, fname, data, cd, fname, eocd])
}
