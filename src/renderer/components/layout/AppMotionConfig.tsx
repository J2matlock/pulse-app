import React from 'react'
import { MotionConfig } from 'motion/react'
import { useSettingsStore } from '../../stores/settingsStore'

/**
 * Animations follow Settings → Reduce motion as well as the computer's own
 * setting (audit A06-16). The .reduce-motion CSS class can't stop motion's
 * JavaScript animations, so the switch has to reach MotionConfig too.
 */
export function AppMotionConfig({ children }: { children: React.ReactNode }): React.ReactElement {
  const reducedMotion = useSettingsStore(s => s.reducedMotion)
  return <MotionConfig reducedMotion={reducedMotion ? 'always' : 'user'}>{children}</MotionConfig>
}
