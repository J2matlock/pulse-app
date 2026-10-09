import { useEffect } from 'react'

type ThemeValue = 'light' | 'dark' | 'system'
type GridDensity = 'compact' | 'comfortable' | 'spacious'
type SidebarWidth = 'narrow' | 'normal' | 'wide'
type GridLines = 'full' | 'horizontal' | 'none'

/**
 * Applies theme class (dark/light/system) and display settings
 * (density, sidebar width, grid lines, striping, motion, contrast)
 * to the document root element.
 */
export function useThemeEffect(
  theme: ThemeValue,
  uiScale: number,
  gridDensity: GridDensity,
  sidebarWidth: SidebarWidth,
  gridLines: GridLines,
  rowStriping: boolean,
  reducedMotion: boolean,
  highContrast: boolean,
): void {
  // Theme class on document root
  useEffect(() => {
    const root = document.documentElement
    if (theme === 'dark') {
      root.classList.add('dark')
    } else if (theme === 'light') {
      root.classList.remove('dark')
    } else {
      // system: use prefers-color-scheme
      const mq = window.matchMedia('(prefers-color-scheme: dark)')
      if (mq.matches) root.classList.add('dark')
      else root.classList.remove('dark')

      const handler = (e: MediaQueryListEvent) => {
        if (e.matches) root.classList.add('dark')
        else root.classList.remove('dark')
      }
      mq.addEventListener('change', handler)
      return () => mq.removeEventListener('change', handler)
    }
  }, [theme])

  // Display settings (density, sidebar, grid lines, striping, motion, contrast, zoom)
  useEffect(() => {
    const root = document.documentElement

    // Use Electron's webFrame zoom (scales entire page properly, no layout gaps)
    window.api.setZoomFactor(uiScale / 100)

    const rowHeights: Record<GridDensity, string> = { compact: '44px', comfortable: '44px', spacious: '52px' }
    const cellPaddings: Record<GridDensity, string> = { compact: '6px', comfortable: '12px', spacious: '16px' }
    root.style.setProperty('--row-height', rowHeights[gridDensity])
    root.style.setProperty('--cell-padding', cellPaddings[gridDensity])

    const sidebarWidths: Record<SidebarWidth, string> = { narrow: '180px', normal: '220px', wide: '280px' }
    root.style.setProperty('--width-sidebar-expanded', sidebarWidths[sidebarWidth])

    root.classList.toggle('grid-lines-horizontal', gridLines === 'horizontal')
    root.classList.toggle('grid-lines-none', gridLines === 'none')

    root.classList.toggle('striped-rows', rowStriping)

    root.classList.toggle('reduce-motion', reducedMotion)

    root.classList.toggle('high-contrast', highContrast)
  }, [uiScale, gridDensity, sidebarWidth, gridLines, rowStriping, reducedMotion, highContrast])
}
