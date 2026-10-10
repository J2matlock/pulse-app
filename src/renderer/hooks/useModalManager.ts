import { useState, type Dispatch, type SetStateAction } from 'react'
import type { TourStep } from '../components/shared/TourOverlay'

interface UseModalManagerReturn {
  /** true: the short first-run tour; 'full': every step (Help → Retake full tour) */
  showTour: boolean | 'full'
  setShowTour: Dispatch<SetStateAction<boolean | 'full'>>
  commandPaletteOpen: boolean
  setCommandPaletteOpen: Dispatch<SetStateAction<boolean>>
  shortcutsOpen: boolean
  setShortcutsOpen: Dispatch<SetStateAction<boolean>>
  whatsNewOpen: boolean
  setWhatsNewOpen: Dispatch<SetStateAction<boolean>>
  miniTourSteps: TourStep[] | null
  setMiniTourSteps: Dispatch<SetStateAction<TourStep[] | null>>
  globalTaskOpen: boolean
  setGlobalTaskOpen: Dispatch<SetStateAction<boolean>>
}

export function useModalManager(): UseModalManagerReturn {
  const [showTour, setShowTour] = useState<boolean | 'full'>(false)
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [whatsNewOpen, setWhatsNewOpen] = useState(false)
  const [miniTourSteps, setMiniTourSteps] = useState<TourStep[] | null>(null)
  const [globalTaskOpen, setGlobalTaskOpen] = useState(false)

  return {
    showTour,
    setShowTour,
    commandPaletteOpen,
    setCommandPaletteOpen,
    shortcutsOpen,
    setShortcutsOpen,
    whatsNewOpen,
    setWhatsNewOpen,
    miniTourSteps,
    setMiniTourSteps,
    globalTaskOpen,
    setGlobalTaskOpen,
  }
}
