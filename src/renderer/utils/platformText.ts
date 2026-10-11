/**
 * Words that depend on the computer Pulse runs on (audit X-40, N-25, F-36).
 * Pulse ships as a portable .exe on Windows, a .dmg on Mac and an AppImage on
 * Linux, so "replace PULSE.exe" is only true on Windows.
 */
import { useEffect, useState } from 'react'
import { IPC } from '../../shared/ipc-channels'
import { safeInvoke } from './safeInvoke'

export type Platform = 'win32' | 'darwin' | 'linux' | 'other'

export function toPlatform(p: string | undefined | null): Platform {
  return p === 'win32' || p === 'darwin' || p === 'linux' ? p : 'other'
}

let cached: Platform | null = null

/** The platform, from the main process; null until known */
export function usePlatform(): Platform | null {
  const [platform, setPlatform] = useState<Platform | null>(cached)
  useEffect(() => {
    if (cached) return
    let alive = true
    void safeInvoke<{ platform: string }>(IPC.APP_GET_INFO).then(res => {
      if (!res.ok) return
      cached = toPlatform(res.data.platform)
      if (alive) setPlatform(cached)
    })
    return () => { alive = false }
  }, [])
  return platform
}

export interface UpdateText {
  /** One line for the update banner */
  banner: string
  /** Numbered steps for Settings > About */
  steps: string[]
  /** Where the data lives, and that updating doesn't touch it */
  dataNote: string
}

export function updateText(platform: Platform | null): UpdateText {
  switch (platform) {
    case 'win32':
      return {
        banner: 'Download it, close Pulse, and open the new Pulse file in place of the old one. Your data stays where it is.',
        steps: [
          'Click Download update above. The new Pulse file goes to your Downloads folder.',
          'Close Pulse.',
          'Move the new file to where you keep Pulse, replacing the old one.',
          'Open the new file. If Windows says "Windows protected your PC", click More info, then Run anyway.',
        ],
        dataNote: 'Your data is kept in the PulseData folder next to Pulse, and updating never touches it. A backup before updating is still a good idea.',
      }
    case 'darwin':
      return {
        banner: 'Download it, close Pulse, and drag the new Pulse into Applications. Your data stays where it is.',
        steps: [
          'Click Download update above and open the file that downloads.',
          'Close Pulse.',
          'Drag Pulse into your Applications folder, and choose Replace.',
          'Open Pulse from Applications.',
        ],
        dataNote: 'Your data is kept in its own folder on this Mac, apart from the app, and updating never touches it. A backup before updating is still a good idea.',
      }
    case 'linux':
      return {
        banner: 'Download the new AppImage, close Pulse, and open the new one instead. Your data stays where it is.',
        steps: [
          'Click Download update above. The new .AppImage file goes to your Downloads folder.',
          'Close Pulse.',
          'Put the new file where you keep Pulse, and allow it to run as a program (right-click, Properties, Permissions).',
          'Open the new file. You can delete the old one.',
        ],
        dataNote: 'Your data is kept in its own folder on this computer, apart from the app, and updating never touches it. A backup before updating is still a good idea.',
      }
    default:
      return {
        banner: 'Download the new version, close Pulse, and open the new one. Your data stays where it is.',
        steps: [
          'Click Download update above.',
          'Close Pulse.',
          'Open the new version in place of the old one.',
        ],
        dataNote: 'Your data is kept apart from the app, and updating never touches it. A backup before updating is still a good idea.',
      }
  }
}

/** What to do when Pulse's data folder sits in a folder that a cloud service syncs */
export function cloudFolderAdvice(service: string, platform: Platform | null): string {
  const move = platform === 'win32'
    ? 'Close Pulse, move Pulse and its PulseData folder to a folder that isn\'t synced (for example C:\\Pulse), and open Pulse from there.'
    : 'Ask whoever looks after this computer to keep Pulse\'s data folder out of the synced folder.'
  return `Pulse's data folder is inside ${service}. Syncing can damage the encrypted data while Pulse is open. ${move}`
}
