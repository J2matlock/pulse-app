/**
 * profileStore.test.ts — Zustand profile store unit tests.
 * The profileStore is a simple client-side store (no IPC), managing
 * recent profiles and scroll position.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useProfileStore, type RecentProfile } from '../../../src/renderer/stores/profileStore'
import { useGridStore } from '../../../src/renderer/stores/gridStore'
import { pulseEvents } from '../../../src/renderer/events'

function makeProfile(rowId: number, overrides: Partial<RecentProfile> = {}): RecentProfile {
  return {
    rowId,
    gridId: 1,
    name: `Client ${rowId}`,
    gridName: 'Test Grid',
    visitedAt: new Date().toISOString(),
    ...overrides,
  }
}

describe('profileStore', () => {
  beforeEach(() => {
    useProfileStore.setState({
      recentProfiles: [],
      savedScroll: null,
    })
  })

  it('addRecentProfile adds profile to list', () => {
    useProfileStore.getState().addRecentProfile(makeProfile(1))
    expect(useProfileStore.getState().recentProfiles).toHaveLength(1)
    expect(useProfileStore.getState().recentProfiles[0].name).toBe('Client 1')
  })

  it('addRecentProfile deduplicates by rowId (most recent first)', () => {
    useProfileStore.getState().addRecentProfile(makeProfile(1, { name: 'First Visit' }))
    useProfileStore.getState().addRecentProfile(makeProfile(2))
    useProfileStore.getState().addRecentProfile(makeProfile(1, { name: 'Second Visit' }))

    const profiles = useProfileStore.getState().recentProfiles
    expect(profiles).toHaveLength(2)
    // Most recent visit to row 1 should be first
    expect(profiles[0].rowId).toBe(1)
    expect(profiles[0].name).toBe('Second Visit')
    expect(profiles[1].rowId).toBe(2)
  })

  it('addRecentProfile trims to 10 entries', () => {
    for (let i = 1; i <= 15; i++) {
      useProfileStore.getState().addRecentProfile(makeProfile(i))
    }

    expect(useProfileStore.getState().recentProfiles).toHaveLength(10)
    // Most recent (id=15) should be first
    expect(useProfileStore.getState().recentProfiles[0].rowId).toBe(15)
  })

  it('saveScrollTop persists scroll position, for its list', () => {
    useProfileStore.getState().saveScrollTop(3, 500)
    expect(useProfileStore.getState().savedScroll).toEqual({ gridId: 3, top: 500 })

    useProfileStore.getState().saveScrollTop(3, 0)
    expect(useProfileStore.getState().savedScroll).toEqual({ gridId: 3, top: 0 })

    useProfileStore.getState().clearSavedScroll()
    expect(useProfileStore.getState().savedScroll).toBeNull()
  })

  it('clearRecentProfiles resets state', () => {
    useProfileStore.getState().addRecentProfile(makeProfile(1))
    useProfileStore.getState().addRecentProfile(makeProfile(2))
    useProfileStore.getState().addRecentProfile(makeProfile(3))

    expect(useProfileStore.getState().recentProfiles).toHaveLength(3)

    useProfileStore.getState().clearRecentProfiles()
    expect(useProfileStore.getState().recentProfiles).toEqual([])
  })

  it('navigation simulation: next/prev profiles via addRecentProfile', () => {
    // Simulate navigating through profiles
    const profiles = [makeProfile(1), makeProfile(2), makeProfile(3)]
    profiles.forEach(p => useProfileStore.getState().addRecentProfile(p))

    const recent = useProfileStore.getState().recentProfiles
    expect(recent).toHaveLength(3)
    // Last added is first in list
    expect(recent[0].rowId).toBe(3)
    expect(recent[1].rowId).toBe(2)
    expect(recent[2].rowId).toBe(1)
  })

  it('preserves gridId and gridName on profiles', () => {
    useProfileStore.getState().addRecentProfile(
      makeProfile(1, { gridId: 42, gridName: 'My Caseload' })
    )

    const profile = useProfileStore.getState().recentProfiles[0]
    expect(profile.gridId).toBe(42)
    expect(profile.gridName).toBe('My Caseload')
  })

  it('handles re-adding same profile across different grids', () => {
    useProfileStore.getState().addRecentProfile(makeProfile(1, { gridId: 1, gridName: 'Grid A' }))
    useProfileStore.getState().addRecentProfile(makeProfile(1, { gridId: 2, gridName: 'Grid B' }))

    // Same rowId => deduplicated, keeps latest
    const profiles = useProfileStore.getState().recentProfiles
    expect(profiles).toHaveLength(1)
    expect(profiles[0].gridName).toBe('Grid B')
  })
})

describe('pruning Recent', () => {
  const invoke = vi.fn()
  beforeEach(() => {
    ;(globalThis as Record<string, unknown>).window = { api: { invoke } }
    invoke.mockReset()
    useProfileStore.setState({ recentProfiles: [makeProfile(1), makeProfile(2), makeProfile(3), makeProfile(4)] })
    useGridStore.setState({ grids: [{ id: 1, name: 'Waitlist' }, { id: 7, name: 'Active' }] as never })
  })

  it('drops records in the Trash or on a deleted list, follows moved ones, keeps what it cannot check', async () => {
    invoke.mockImplementation(async (_channel: string, rowId: number) => {
      if (rowId === 1) return { ok: true, data: { gridId: 1, status: 'trash', archivedReason: null } }
      if (rowId === 2) return { ok: true, data: { gridId: 7, status: 'active', archivedReason: null } }
      if (rowId === 3) return { ok: true, data: null }
      return { ok: false, error: 'busy' }
    })
    await useProfileStore.getState().pruneRecentProfiles()
    expect(useProfileStore.getState().recentProfiles.map(p => [p.rowId, p.gridId, p.gridName])).toEqual([[2, 7, 'Active'], [4, 1, 'Test Grid']])
  })

  it('runs when the sample data changes', async () => {
    invoke.mockResolvedValue({ ok: true, data: null })
    pulseEvents.emit('sample-data:changed')
    await new Promise(r => setTimeout(r, 0))
    expect(useProfileStore.getState().recentProfiles).toEqual([])
  })

  it('a record moved to the Trash from the list leaves Recent at once (Q-048)', async () => {
    invoke.mockResolvedValue({ ok: true, data: true })
    useGridStore.setState({ activeGridId: 1, rows: [{ row_id: 2 }] as never, columns: [] })
    await useGridStore.getState().deleteRow(2)
    expect(useProfileStore.getState().recentProfiles.map(p => p.rowId)).toEqual([1, 3, 4])
  })

  it('records trashed by the handful leave at once; a list moved to the Trash checks them all (Q-048)', async () => {
    pulseEvents.emit('records:trashed', { rowIds: [1, 3] })
    expect(useProfileStore.getState().recentProfiles.map(p => p.rowId)).toEqual([2, 4])
    invoke.mockImplementation(async (_channel: string, rowId: number) => ({ ok: true, data: { gridId: 1, status: rowId === 2 ? 'list-deleted' : 'active', archivedReason: null } }))
    pulseEvents.emit('records:trashed', {})
    await new Promise(r => setTimeout(r, 0))
    expect(useProfileStore.getState().recentProfiles.map(p => p.rowId)).toEqual([4])
  })

  it('removeRecentProfile drops one record', () => {
    useProfileStore.getState().removeRecentProfile(2)
    expect(useProfileStore.getState().recentProfiles.map(p => p.rowId)).toEqual([1, 3, 4])
  })
})
