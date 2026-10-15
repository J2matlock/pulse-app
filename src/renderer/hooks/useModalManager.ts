import { useEffect, useState, type Dispatch, type SetStateAction } from 'react'
import { pulseEvents } from '../events'
import type { TourStep } from '../components/shared/TourOverlay'

interface UseModalManagerReturn {
  /** The tour Help plays: every step that's switched on */
  showTour: boolean
  setShowTour: Dispatch<SetStateAction<boolean>>
  /** "Here's your caseload" after a true first run (UX pass Q7) */
  firstLook: boolean
  setFirstLook: Dispatch<SetStateAction<boolean>>
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
  const [showTour, setShowTour] = useState(false)
  const [firstLook, setFirstLook] = useState(false)
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [whatsNewOpen, setWhatsNewOpen] = useState(false)
  const [miniTourSteps, setMiniTourSteps] = useState<TourStep[] | null>(null)
  const [globalTaskOpen, setGlobalTaskOpen] = useState(false)
  // Help, Settings → About, and the first unlock after an update open What's New
  useEffect(() => pulseEvents.on('whats-new:open', () => setWhatsNewOpen(true)), [])

  return {
    showTour,
    setShowTour,
    firstLook,
    setFirstLook,
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
