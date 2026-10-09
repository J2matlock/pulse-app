/**
 * profileStore.test.ts — Zustand profile store unit tests.
 * The profileStore is a simple client-side store (no IPC), managing
 * recent profiles and scroll position.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { useProfileStore, type RecentProfile } from '../../../src/renderer/stores/profileStore'

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
      savedScrollTop: 0,
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

  it('saveScrollTop persists scroll position', () => {
    useProfileStore.getState().saveScrollTop(500)
    expect(useProfileStore.getState().savedScrollTop).toBe(500)

    useProfileStore.getState().saveScrollTop(0)
    expect(useProfileStore.getState().savedScrollTop).toBe(0)
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
