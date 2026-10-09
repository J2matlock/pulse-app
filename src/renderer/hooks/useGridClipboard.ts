/**
 * useGridClipboard — manages internal clipboard state for DataGrid.
 * The actual copy/paste keyboard handling is in gridKeyboardNav.ts;
 * this hook owns the clipboard state and ref that it depends on.
 */
import { useState, useRef } from 'react'

export function useGridClipboard() {
  const [clipboard, setClipboard] = useState<string | null>(null)
  const clipboardRef = useRef<string | null>(null)
  clipboardRef.current = clipboard

  return {
    clipboard,
    setClipboard,
    clipboardRef,
  }
}
