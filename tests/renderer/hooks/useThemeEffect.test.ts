/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook } from '@testing-library/react'

// Mock window.api.setZoomFactor
const mockSetZoomFactor = vi.fn()
Object.defineProperty(window, 'api', {
  value: { setZoomFactor: mockSetZoomFactor },
  writable: true,
  configurable: true,
})

// Provide a base matchMedia implementation for jsdom (which lacks it)
function createMatchMedia(matches: boolean) {
  return {
    matches,
    media: '',
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  } as unknown as MediaQueryList
}

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  configurable: true,
  value: vi.fn().mockImplementation(() => createMatchMedia(false)),
})

import { useThemeEffect } from '../../../src/renderer/hooks/useThemeEffect'

describe('useThemeEffect', () => {
  beforeEach(() => {
    mockSetZoomFactor.mockReset()
    vi.mocked(window.matchMedia).mockImplementation(() => createMatchMedia(false))
    document.documentElement.className = ''
    document.documentElement.style.cssText = ''
  })

  const defaultArgs = {
    theme: 'light' as const,
    uiScale: 100,
    gridDensity: 'comfortable' as const,
    sidebarWidth: 'normal' as const,
    gridLines: 'both' as const,
    rowStriping: false,
    reducedMotion: false,
    highContrast: false,
  }

  function render(overrides: Partial<typeof defaultArgs> = {}) {
    const args = { ...defaultArgs, ...overrides }
    return renderHook(() =>
      useThemeEffect(
        args.theme, args.uiScale, args.gridDensity, args.sidebarWidth,
        args.gridLines, args.rowStriping, args.reducedMotion, args.highContrast,
      ),
    )
  }

  it('adds dark class for dark theme', () => {
    render({ theme: 'dark' })
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('removes dark class for light theme', () => {
    document.documentElement.classList.add('dark')
    render({ theme: 'light' })
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('uses matchMedia for system theme (dark)', () => {
    const mockMq = createMatchMedia(true)
    vi.mocked(window.matchMedia).mockReturnValue(mockMq)

    render({ theme: 'system' })
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(mockMq.addEventListener).toHaveBeenCalledWith('change', expect.any(Function))
  })

  it('uses matchMedia for system theme (light)', () => {
    const mockMq = createMatchMedia(false)
    vi.mocked(window.matchMedia).mockReturnValue(mockMq)

    render({ theme: 'system' })
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('sets CSS custom properties for density', () => {
    render({ gridDensity: 'compact' })
    expect(document.documentElement.style.getPropertyValue('--row-height')).toBe('44px')
    expect(document.documentElement.style.getPropertyValue('--cell-padding')).toBe('6px')
  })

  it('sets sidebar width CSS property', () => {
    render({ sidebarWidth: 'wide' })
    expect(document.documentElement.style.getPropertyValue('--width-sidebar-expanded')).toBe('280px')
  })

  it('calls setZoomFactor with uiScale / 100', () => {
    render({ uiScale: 120 })
    expect(mockSetZoomFactor).toHaveBeenCalledWith(1.2)
  })

  it('toggles striped-rows class', () => {
    render({ rowStriping: true })
    expect(document.documentElement.classList.contains('striped-rows')).toBe(true)

    render({ rowStriping: false })
    expect(document.documentElement.classList.contains('striped-rows')).toBe(false)
  })

  it('toggles high-contrast class', () => {
    render({ highContrast: true })
    expect(document.documentElement.classList.contains('high-contrast')).toBe(true)
  })

  it('toggles reduce-motion class', () => {
    render({ reducedMotion: true })
    expect(document.documentElement.classList.contains('reduce-motion')).toBe(true)
  })

  it('toggles grid-lines-horizontal class', () => {
    render({ gridLines: 'horizontal' })
    expect(document.documentElement.classList.contains('grid-lines-horizontal')).toBe(true)
  })

  it('cleans up matchMedia listener on unmount (system theme)', () => {
    const mockMq = createMatchMedia(false)
    vi.mocked(window.matchMedia).mockReturnValue(mockMq)

    const { unmount } = render({ theme: 'system' })
    unmount()
    expect(mockMq.removeEventListener).toHaveBeenCalledWith('change', expect.any(Function))
  })
})
