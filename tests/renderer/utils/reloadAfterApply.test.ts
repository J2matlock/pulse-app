// @vitest-environment jsdom
/** After an example or template is applied, every store that shows what it added reloads (polish R2). */
import { describe, it, expect, vi, beforeEach } from 'vitest'

Object.defineProperty(window, 'api', { value: { invoke: vi.fn(async () => ({ ok: true, data: [] })), on: () => () => {} }, writable: true, configurable: true })

import { reloadAfterApply } from '../../../src/renderer/utils/reloadAfterApply'
import { useGridStore } from '../../../src/renderer/stores/gridStore'
import { useAlertStore } from '../../../src/renderer/stores/alertStore'
import { useLinkStore } from '../../../src/renderer/stores/linkStore'
import { useWorkspaceStore } from '../../../src/renderer/stores/workspaceStore'

const fns = () => ({
  loadGridList: vi.fn(async () => {}), loadGrid: vi.fn(async () => {}),
  loadRules: vi.fn(async () => {}), loadLinks: vi.fn(async () => {}), loadWords: vi.fn(async () => {}),
})
let f: ReturnType<typeof fns>

beforeEach(() => {
  f = fns()
  useGridStore.setState({ loadGridList: f.loadGridList, loadGrid: f.loadGrid, activeGridId: 5 })
  useAlertStore.setState({ loadRules: f.loadRules })
  useLinkStore.setState({ load: f.loadLinks })
  useWorkspaceStore.setState({ load: f.loadWords })
})

describe('reloadAfterApply', () => {
  it('reloads lists, deadline rules, link types and words even when they were loaded before', async () => {
    useAlertStore.setState({ isLoaded: true })
    useLinkStore.setState({ isLoaded: true })
    await reloadAfterApply()
    expect(f.loadGridList).toHaveBeenCalled()
    expect(f.loadRules).toHaveBeenCalled()
    expect(f.loadLinks).toHaveBeenCalled()
    expect(f.loadWords).toHaveBeenCalled()
    expect(f.loadGrid).not.toHaveBeenCalled()
  })

  it('reloads the open list when the template added columns to it', async () => {
    await reloadAfterApply(5)
    expect(f.loadGrid).toHaveBeenCalledWith(5)
    f.loadGrid.mockClear()
    await reloadAfterApply(9)
    expect(f.loadGrid).not.toHaveBeenCalled()
  })
})
