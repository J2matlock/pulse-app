import React from 'react'
import { Download } from 'lucide-react'
import { IPC } from '../../../shared/ipc-channels'
import { safeInvoke } from '../../utils/safeInvoke'
import { usePlatform, updateText } from '../../utils/platformText'

interface Props {
  version: string
  downloadUrl?: string
  /** "Remind me later": hides it for this session */
  onDismiss: () => void
  /** "Skip this version": hides this version for good (a newer one still shows) */
  onSkip: () => void
}

export function UpdateBanner({ version, downloadUrl, onDismiss, onSkip }: Props): React.ReactElement {
  const platform = usePlatform()
  function openDownload() {
    const url = downloadUrl || 'https://github.com/J2matlock/pulse-releases/releases/latest'
    void safeInvoke(IPC.APP_OPEN_EXTERNAL, url)
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 bg-blue-600 text-white text-base flex-shrink-0"
    >
      <Download className="w-4 h-4 flex-shrink-0" />
      <span className="flex-1">
        Version {version} is available. {updateText(platform).banner}
      </span>
      <button
        onClick={openDownload}
        className="hit-44 px-3 py-1 rounded-sm bg-white text-blue-700 font-medium text-base
                   hover:bg-blue-50 focus-visible:outline-hidden focus-visible:ring-3
                   focus-visible:ring-white focus-visible:ring-offset-3 focus-visible:ring-offset-blue-600
                   transition-colors whitespace-nowrap"
        style={{ minHeight: 44 }}
      >
        Download update
      </button>
      <button
        onClick={onSkip}
        className="hit-44 px-3 py-1 rounded-sm text-white font-medium text-base underline-offset-2
                   hover:bg-blue-700 hover:underline focus-visible:outline-hidden focus-visible:ring-3
                   focus-visible:ring-white transition-colors whitespace-nowrap"
        style={{ minHeight: 44 }}
      >
        Skip this version
      </button>
      <button
        onClick={onDismiss}
        className="hit-44 px-3 py-1 rounded-sm text-white font-medium text-base underline-offset-2
                   hover:bg-blue-700 hover:underline focus-visible:outline-hidden focus-visible:ring-3
                   focus-visible:ring-white transition-colors whitespace-nowrap"
        style={{ minHeight: 44 }}
      >
        Remind me later
      </button>
    </div>
  )
}
