/**
 * fold-line.ts — content-line folding shared by the .ics (RFC 5545 §3.1) and
 * .vcf (RFC 6350 §3.2) writers. Kept free of imports so either can use it.
 */

/**
 * Fold a line longer than 75 octets: CRLF then a space before each
 * continuation, never splitting a UTF-8 character. Some address books and
 * calendars reject or cut long unfolded lines.
 */
export function foldLine(line: string): string {
  const bytes = Buffer.from(line, 'utf8')
  if (bytes.length <= 75) return line
  const parts: string[] = []
  let start = 0
  while (start < bytes.length) {
    let end = Math.min(start + (start === 0 ? 75 : 74), bytes.length)
    // Don't split a multi-byte character
    while (end < bytes.length && (bytes[end]! & 0xc0) === 0x80) end--
    parts.push(bytes.subarray(start, end).toString('utf8'))
    start = end
  }
  return parts.join('\r\n ')
}
