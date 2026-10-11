import React from 'react'
import { X, Download } from 'lucide-react'
import { IPC } from '../../../shared/ipc-channels'
import { safeInvoke } from '../../utils/safeInvoke'
import { usePlatform, updateText } from '../../utils/platformText'

interface Props {
  version: string
  downloadUrl?: string
  onDismiss: () => void
}

export function UpdateBanner({ version, downloadUrl, onDismiss }: Props): React.ReactElement {
  const platform = usePlatform()
  function openDownload() {
    const url = downloadUrl || 'https://github.com/J2matlock/pulse-releases/releases/latest'
    void safeInvoke(IPC.APP_OPEN_EXTERNAL, url)
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-3 px-4 py-2 bg-blue-600 text-white text-base flex-shrink-0"
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
        onClick={onDismiss}
        aria-label="Dismiss update notification"
        className="hit-44 p-1 rounded-sm hover:bg-blue-700 focus-visible:outline-hidden
                   focus-visible:ring-3 focus-visible:ring-white transition-colors"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  )
}
