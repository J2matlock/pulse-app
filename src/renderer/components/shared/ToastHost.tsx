/**
 * The one place toasts appear: a single column in the bottom-right corner.
 * Render <ToastHost /> once per screen (App.tsx does); call sites keep using
 * react-hot-toast's toast(), toast.success() and toast.error() as before.
 *
 * - withUndo: the Undo toast (undoStore) sits at the bottom of the column and
 *   the other toasts stack above it, never on top of it. Its height is
 *   measured with a ResizeObserver; without one (jsdom) a fixed 96 px is kept
 *   free while it shows.
 * - Toasts follow the theme (dark in dark mode), use 15 px text and 8 px
 *   corners, stay 5.5 s by default, and show lucide icons, not emoji. For a
 *   warning or key icon on a plain toast(): { icon: <ToastIcon kind="warning" /> }
 *   (in a .ts file: createElement(ToastIcon, { kind: 'warning' })).
 */
import React, { useEffect, useRef, useState } from 'react'
import { Toaster } from 'react-hot-toast'
import { AlertTriangle, CheckCircle2, KeyRound } from 'lucide-react'
import { UndoToast } from './UndoToast'
import { ErrorBoundary } from './ErrorBoundary'
import { useUndoStore } from '../../stores/undoStore'
import { LAYER } from '../ui/layers'

/** Space from the window's bottom and right edges, and between toasts */
export const TOAST_EDGE = 24
export const TOAST_GAP = 8
/** Kept free for the Undo toast when its height can't be measured */
export const UNDO_FALLBACK_HEIGHT = 96

export type ToastIconKind = 'success' | 'error' | 'warning' | 'key'

const ICON_CLASS: Record<ToastIconKind, string> = {
  success: 'text-green-600 dark:text-green-400',
  error: 'text-red-600 dark:text-red-400',
  warning: 'text-amber-700 dark:text-amber-400',
  key: 'text-accent',
}

/** The icon at the start of a toast */
export function ToastIcon({ kind }: { kind: ToastIconKind }): React.ReactElement {
  const cls = `w-5 h-5 flex-shrink-0 ${ICON_CLASS[kind]}`
  if (kind === 'success') return <CheckCircle2 className={cls} aria-hidden="true" />
  if (kind === 'key') return <KeyRound className={cls} aria-hidden="true" />
  return <AlertTriangle className={cls} aria-hidden="true" />
}

const TOAST_STYLE: React.CSSProperties = {
  background: 'var(--toast-bg)',
  color: 'var(--toast-fg)',
  border: '1px solid var(--toast-border)',
  borderRadius: 8,
  lineHeight: 1.5,
  maxWidth: 420,
  padding: '12px 16px',
}

function useUndoHeight(withUndo: boolean): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement>(null)
  const showing = useUndoStore(s => s.toast !== null)
  const [measured, setMeasured] = useState<number | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!withUndo || !el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => setMeasured(el.getBoundingClientRect().height))
    ro.observe(el)
    setMeasured(el.getBoundingClientRect().height)
    return () => ro.disconnect()
  }, [withUndo])

  if (!withUndo || !showing) return [ref, 0]
  // Measured 0 while it shows means no layout (jsdom); keep room anyway
  return [ref, measured && measured > 0 ? measured : UNDO_FALLBACK_HEIGHT]
}

export function ToastHost({ withUndo = false }: { withUndo?: boolean }): React.ReactElement {
  const [undoRef, undoHeight] = useUndoHeight(withUndo)
  const bottom = TOAST_EDGE + (undoHeight > 0 ? undoHeight + TOAST_GAP : 0)
  return (
    <>
      {withUndo && (
        <div ref={undoRef} data-testid="undo-toast-slot" className={`fixed ${LAYER.toast}`} style={{ bottom: TOAST_EDGE, right: TOAST_EDGE }}>
          <ErrorBoundary fallback={null}>
            <UndoToast />
          </ErrorBoundary>
        </div>
      )}
      <Toaster
        position="bottom-right"
        gutter={TOAST_GAP}
        containerStyle={{ bottom, right: TOAST_EDGE }}
        toastOptions={{
          duration: 5500,
          className: 'text-base',
          style: TOAST_STYLE,
          success: { icon: <ToastIcon kind="success" /> },
          error: { icon: <ToastIcon kind="error" /> },
        }}
      />
    </>
  )
}
