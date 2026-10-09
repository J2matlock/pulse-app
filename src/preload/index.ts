import { contextBridge, ipcRenderer, webFrame, webUtils } from 'electron'
import type { IPCChannel } from '../shared/ipc-channels'
import { IPC } from '../shared/ipc-channels'

const allowedChannels = new Set<string>(Object.values(IPC))

// Expose a safe, narrow API to the renderer via contextBridge.
// The renderer can only call channels on the whitelist — nothing else.
contextBridge.exposeInMainWorld('api', {
  invoke: (channel: IPCChannel, ...args: unknown[]): Promise<unknown> => {
    if (!allowedChannels.has(channel)) {
      return Promise.reject(new Error(`IPC channel not allowed: ${channel}`))
    }
    return ipcRenderer.invoke(channel, ...args)
  },

  copyToClipboard: (text: string): Promise<unknown> => {
    return ipcRenderer.invoke(IPC.CLIPBOARD_WRITE, text)
  },

  setZoomFactor: (factor: number): void => {
    webFrame.setZoomFactor(factor)
  },

  /** A dropped file's path (W09); main still checks it before reading */
  pathForFile: (file: File): string => {
    try { return webUtils.getPathForFile(file) } catch { return '' }
  },

  on: (channel: IPCChannel, callback: (...args: unknown[]) => void): (() => void) => {
    if (!allowedChannels.has(channel)) {
      throw new Error(`IPC channel not allowed: ${channel}`)
    }
    const handler = (_event: Electron.IpcRendererEvent, ...args: unknown[]) => callback(...args)
    ipcRenderer.on(channel, handler)
    return () => ipcRenderer.removeListener(channel, handler)
  }
})
