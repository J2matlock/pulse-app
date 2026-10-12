/**
 * The preload's two entry points each take only their own kind of channel (Q-055): invoke reaches
 * the channels main handles, on reaches the channels main sends.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest'

const exposed = vi.hoisted(() => ({ api: null as null | Record<string, (...a: unknown[]) => unknown> }))
const ipcRenderer = vi.hoisted(() => ({ invoke: vi.fn(async () => ({ ok: true, data: null })), on: vi.fn(), removeListener: vi.fn() }))
vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: (_k: string, api: Record<string, (...a: unknown[]) => unknown>) => { exposed.api = api } },
  ipcRenderer,
  webFrame: { setZoomFactor: () => {} },
  webUtils: { getPathForFile: () => '' },
}))

import { IPC, EVENT_CHANNELS } from '../src/shared/ipc-channels'

beforeAll(async () => { await import('../src/preload/index') })

describe('preload channel checks', () => {
  it('invoke passes an invoke channel through and refuses an event channel', async () => {
    await exposed.api!.invoke!(IPC.GRID_GET_ALL)
    expect(ipcRenderer.invoke).toHaveBeenCalledWith(IPC.GRID_GET_ALL)
    for (const ev of EVENT_CHANNELS) {
      await expect(exposed.api!.invoke!(ev)).rejects.toThrow(/not allowed/)
    }
    await expect(exposed.api!.invoke!('not:a-channel')).rejects.toThrow(/not allowed/)
  })

  it('on listens on an event channel and refuses an invoke channel', () => {
    const off = exposed.api!.on!(IPC.AUTH_FORCE_LOCK, () => {}) as () => void
    expect(ipcRenderer.on).toHaveBeenCalledWith(IPC.AUTH_FORCE_LOCK, expect.any(Function))
    off()
    expect(ipcRenderer.removeListener).toHaveBeenCalled()
    expect(() => exposed.api!.on!(IPC.GRID_GET_ALL, () => {})).toThrow(/not allowed/)
  })
})
