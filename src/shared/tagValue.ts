/**
 * A Tags cell holds a JSON array (`["urgent","spanish"]`). Older imports can
 * hold plain comma-separated text, which is read the same way.
 */
export function tagList(value: string | null | undefined): string[] {
  if (!value) return []
  try {
    const parsed: unknown = JSON.parse(value)
    if (Array.isArray(parsed)) return parsed.map(t => String(t).trim()).filter(Boolean)
  } catch { /* plain text */ }
  return value.split(',').map(t => t.trim()).filter(Boolean)
}

/** Tags as people read them: "urgent, spanish" */
export function tagText(value: string | null | undefined): string {
  return tagList(value).join(', ')
}

/** Typed "urgent, spanish" as the value a Tags cell stores; null when empty */
export function tagValueFromText(text: string): string | null {
  const tags = [...new Set(text.split(',').map(t => t.trim()).filter(Boolean))]
  return tags.length ? JSON.stringify(tags) : null
}
