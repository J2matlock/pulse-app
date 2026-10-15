import type React from 'react'

/** The part of a DOMRect the tour uses, so a spotlight can be built from two elements */
export type TourRect = Pick<DOMRect, 'top' | 'left' | 'right' | 'bottom' | 'width' | 'height'>

/**
 * Compute tooltip positioning given target rect, preferred position, tooltip height,
 * and viewport dimensions. Shared between TourOverlay and MiniTour.
 */
export function computeTooltipPosition(
  rect: TourRect | null,
  position: 'top' | 'bottom' | 'left' | 'right',
  tooltipHeight: number,
  viewport: { width: number; height: number },
  maxWidth: number = 420,
  padding: number = 16,
): React.CSSProperties {
  const style: React.CSSProperties = {
    position: 'fixed',
    zIndex: 10001,
    maxWidth,
    width: Math.min(maxWidth, viewport.width - 48),
  }

  if (!rect) {
    style.left = '50%'
    style.top = '50%'
    style.transform = 'translate(-50%, -50%)'
    return style
  }

  const effectiveHeight = tooltipHeight || 350
  const vh = viewport.height
  const vw = viewport.width

  switch (position) {
    case 'right': {
      const width = Math.min(maxWidth, vw - 48)
      const idealLeft = rect.right + padding
      // No room on the right: go to the left of the target rather than on top of it
      if (idealLeft + width > vw - 16 && rect.left - padding - width >= 16) {
        style.left = rect.left - padding - width
      } else {
        style.left = Math.min(idealLeft, vw - maxWidth - 16)
      }
      style.top = Math.max(16, Math.min(rect.top, vh - effectiveHeight - 16))
      break
    }
    case 'left': {
      style.right = Math.min(vw - rect.left + padding, vw - 40)
      style.top = Math.max(16, Math.min(rect.top, vh - effectiveHeight - 16))
      break
    }
    case 'bottom': {
      const idealTop = rect.bottom + padding
      if (idealTop + effectiveHeight > vh - 16) {
        style.bottom = vh - rect.top + padding
        if (rect.top - padding - effectiveHeight < 0) {
          style.bottom = undefined as unknown as number
          style.top = 16
        }
      } else {
        style.top = idealTop
      }
      style.left = Math.max(16, Math.min(rect.left, vw - maxWidth - 16))
      break
    }
    case 'top': {
      style.bottom = vh - rect.top + padding
      style.left = Math.max(16, Math.min(rect.left, vw - maxWidth - 16))
      break
    }
  }

  return style
}
