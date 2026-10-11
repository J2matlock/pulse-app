/**
 * Rich text (tiptap HTML) as plain text, for exports, printouts and previews.
 * Paragraphs, line breaks, list items and headings become line breaks, so
 * "<p>Call Mom</p><p>Bring forms</p>" reads as two lines, not "Call MomBring forms".
 * Entities are decoded in one pass, so "&amp;lt;" stays "&lt;" (AUDIT-069).
 */

const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

function decodeEntity(match: string, body: string): string {
  if (body[0] === '#') {
    const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : Number(body.slice(1))
    // fromCodePoint, not fromCharCode, so emoji and other characters past U+FFFF survive
    return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match
  }
  return NAMED_ENTITIES[body.toLowerCase()] ?? match
}

export function htmlToText(html: string): string {
  if (!html) return ''
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|blockquote|pre|tr)\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, decodeEntity)
    .replace(/\n+$/, '')
}
