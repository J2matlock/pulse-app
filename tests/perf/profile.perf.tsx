// @vitest-environment jsdom
/**
 * Renderer side of "open a record's page" (plan-Q9 Q9a.3): ProfileView, for
 * real, over the same 5,000 × 40 list the DataGrid benchmark uses. Run with
 * `npm run perf`.
 *
 * Every IPC call goes through a recorder that answers with a small, realistic
 * payload after a microtask, so the page loads the way it does in the app,
 * section by section. Reports: mount commit time, commits until the page is
 * quiet, the IPC calls the page makes by channel (in the order they were
 * made), and how often ProfileView itself redraws after a change to the list
 * in the store. jsdom times: compare before and after, not what people see.
 *
 * Features: the Human services example's, plus Files, Appointments and
 * Linked lists, so every section that fetches on mount is there.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import React, { Profiler } from 'react'
import { render, act, cleanup, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { IPC } from '../../src/shared/ipc-channels'

interface Call { channel: string; args: unknown[]; at: number }
const recorder = vi.hoisted(() => ({ calls: [] as Call[] }))

/** Small answers shaped like the real ones; anything else gets [] or null */
function payload(channel: string): unknown {
  switch (channel) {
    case IPC.SNIPPET_GET_ALL:
      return Array.from({ length: 6 }, (_, i) => ({ id: i + 1, trigger_text: `;s${i}`, expansion: `Snippet text ${i}`, category: null, created_at: '2026-01-01 00:00:00' }))
    case IPC.CASE_LOG_GET:
      return Array.from({ length: 8 }, (_, i) => ({
        id: 100 + i, row_id: 1, content: `<p>Home visit ${i}. Discussed housing application and next steps.</p>`, log_type: i % 3 === 0 ? 'phone' : 'note',
        created_at: `2026-09-${String(20 - i).padStart(2, '0')} 15:00:00`, updated_at: `2026-09-${String(20 - i).padStart(2, '0')} 15:00:00`,
        occurred_at: `2026-09-${String(20 - i).padStart(2, '0')} 15:00:00`, is_pinned: 0, follow_up_date: null, follow_up_completed: 0,
        original_content: null, edited_at: null, voided_at: null, voided_reason: null, source_action_id: null, minutes: null, miles: null,
      }))
    case IPC.CASE_LOG_COUNT: return 8
    case IPC.CASE_LOG_COUNTS: return { total: 8, changes: 0, voided: 0 }
    case IPC.CHECKLIST_GET:
      return Array.from({ length: 4 }, (_, i) => ({
        id: 200 + i, row_id: 1, title: `Checklist step ${i + 1}`, description: null, is_completed: i === 0 ? 1 : 0, due_date: i === 2 ? '2026-10-30' : null,
        completed_at: i === 0 ? '2026-10-01 10:00:00' : null, completed_by: null, position: i, category: null, priority: 'normal', is_archived: 0,
        created_at: '2026-09-01 00:00:00', template_source_id: null, recurrence_rule: null, group_id: null,
      }))
    case IPC.SCRAP_NOTE_GET: return { content: '<p>Prefers morning calls. Daughter is the emergency contact.</p>' }
    case IPC.TAG_GET_ALL: return [{ id: 1, grid_id: 1, name: 'Waiver', color: 'blue', created_at: '' }]
    case IPC.TAG_GET_FOR_ROW: return [1]
    case IPC.SETTINGS_GET_ALL: return {}
    case IPC.APPT_FOR_RECORD: return { upcoming: [], past: [], upcomingTotal: 0, pastTotal: 0 }
    case IPC.SETTINGS_GET: case IPC.GLOBAL_NOTE_GET: return null
    default: return /get-all|list|get-for|links|status|history|search|deadlines:get|contacts/.test(channel) ? [] : null
  }
}

Object.defineProperty(window, 'api', {
  value: {
    invoke: (channel: string, ...args: unknown[]) => {
      recorder.calls.push({ channel, args, at: performance.now() })
      return Promise.resolve().then(() => ({ ok: true, data: payload(channel) }))
    },
    on: () => () => {},
    copyToClipboard: () => {},
  },
  writable: true, configurable: true,
})
Object.defineProperty(window, 'matchMedia', {
  value: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {} }),
  writable: true,
})
class RO { observe() {} unobserve() {} disconnect() {} }
vi.stubGlobal('ResizeObserver', RO)
vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} takeRecords() { return [] } })
Element.prototype.scrollIntoView = function scrollIntoView() {}
vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }))
vi.mock('../../src/renderer/utils/rendererLogger', () => ({ rlog: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))

/** ProfileView calls previousPage() once per render (and nothing else does): a render counter without touching the view */
const profileRenders = vi.hoisted(() => ({ n: 0 }))
vi.mock('../../src/renderer/utils/navHistory', async () => {
  const actual = await vi.importActual<typeof import('../../src/renderer/utils/navHistory')>('../../src/renderer/utils/navHistory')
  return { ...actual, previousPage: (current: string) => { profileRenders.n++; return actual.previousPage(current) } }
})

import ProfileView from '../../src/renderer/views/ProfileView'
import { useGridStore } from '../../src/renderer/stores/gridStore'
import { useAlertStore } from '../../src/renderer/stores/alertStore'
import { useLinkStore } from '../../src/renderer/stores/linkStore'
import { useFormStore } from '../../src/renderer/stores/formStore'
import { useActivityTypeStore } from '../../src/renderer/stores/activityTypeStore'
import { DEFAULT_ACTIVITY_TYPES } from '../../src/shared/activityTypes'
import { setWords, EXISTING_FEATURES } from '../renderer/vocabFixture'
import { RECORDS, COLUMNS, RUNS, OUT_DIR, rows, setupGridStore, record as recordTo, timingTable, round, type Timing } from './gridFixture'

const results: Timing[] = []
const record = (name: string, samples: number[], note?: string) => recordTo(results, name, samples, note)

let commitMs = 0
let commits = 0
let lastCommitAt = 0
const onRender: React.ProfilerOnRenderCallback = (_id, _phase, actualDuration) => {
  commitMs += actualDuration
  commits++
  lastCommitAt = performance.now()
}

/** Wait until a 50 ms stretch passes with no commit and no IPC call */
async function untilQuiet(): Promise<void> {
  for (let i = 0; i < 100; i++) {
    const c = commits, n = recorder.calls.length
    await act(async () => { await new Promise(r => setTimeout(r, 50)) })
    if (commits === c && recorder.calls.length === n) return
  }
  throw new Error('The record page never went quiet')
}

const sortedIds = rows.map(r => r.row_id)
/** What's loaded by the time a record is opened from the list: the grid, rules, link types, forms and note types (loaded at unlock) */
function setup(): void {
  setupGridStore(sortedIds)
  useActivityTypeStore.setState({ types: [...DEFAULT_ACTIVITY_TYPES], isLoaded: true })
  useAlertStore.setState({ isLoaded: true } as Partial<ReturnType<typeof useAlertStore.getState>>)
  useLinkStore.setState({ isLoaded: true, types: [{ id: 1, from_grid_id: 1, to_grid_id: 2, label_forward: 'Household', label_backward: 'Members', cardinality: 'many_to_one', created_at: '', from_grid_name: 'Seed List', to_grid_name: 'Households' }] } as Partial<ReturnType<typeof useLinkStore.getState>>)
  useFormStore.setState({ byGrid: { 1: [] } } as Partial<ReturnType<typeof useFormStore.getState>>)
}

function mount(rowId: number) {
  return render(
    <MemoryRouter initialEntries={[`/profile/${rowId}`]}>
      <Profiler id="profile" onRender={onRender}>
        <Routes><Route path="/profile/:rowId" element={<ProfileView />} /></Routes>
      </Profiler>
    </MemoryRouter>,
  )
}

let channelTable = ''
const callLists: string[][] = []

beforeAll(() => {
  setWords(undefined, undefined, { ...EXISTING_FEATURES, attachments: true, appointments: true, links: true })
})

afterAll(() => {
  const table = timingTable(results)
  console.log(`\n[perf] ProfileView in jsdom over ${RECORDS} records × ${COLUMNS} columns\n${table}\n\nIPC calls on mount:\n${channelTable}\n`)
  if (OUT_DIR) {
    mkdirSync(OUT_DIR, { recursive: true })
    writeFileSync(join(OUT_DIR, 'profile.json'), JSON.stringify({ records: RECORDS, columns: COLUMNS, results, ipcOnMount: callLists[0] ?? [] }, null, 2))
    writeFileSync(join(OUT_DIR, 'profile.md'), `${table}\n\n${channelTable}\n`)
  }
})

describe(`ProfileView over ${RECORDS} records × ${COLUMNS} columns (jsdom)`, () => {
  it('opens a record: commits, time to quiet, IPC calls by channel', async () => {
    let lastCalls: Call[] = []
    const firstCommit: number[] = [], totalCommit: number[] = [], toQuiet: number[] = [], commitCount: number[] = [], callCount: number[] = []
    for (let run = 0; run < RUNS; run++) {
      setup()
      const rowId = rows[run * 97 + 5]!.row_id
      recorder.calls.length = 0
      commitMs = 0; commits = 0
      let first = 0
      const t0 = performance.now()
      const view = mount(rowId)
      first = commitMs
      await untilQuiet()
      firstCommit.push(first); totalCommit.push(commitMs); toQuiet.push(lastCommitAt - t0); commitCount.push(commits); callCount.push(recorder.calls.length)
      expect(screen.getAllByText(`Person ${rowId}`).length).toBeGreaterThan(0)
      callLists.push(recorder.calls.map(c => c.channel))
      lastCalls = [...recorder.calls]
      view.unmount()
      cleanup()
    }
    // Every record opens with the same calls
    for (const list of callLists) expect([...list].sort()).toEqual([...callLists[0]!].sort())

    record('Mount: first commit (React commit time)', firstCommit)
    record('Mount: all commits until quiet (React commit time)', totalCommit)
    record('Mount: wall clock to the last commit', toQuiet)
    record('Mount: commits until quiet (count, not ms)', commitCount)
    record('Mount: IPC calls (count, not ms)', callCount)

    // By channel, in the order of each channel's first call, with the arguments of the last run
    const byChannel = new Map<string, string[]>()
    for (const c of lastCalls) byChannel.set(c.channel, [...(byChannel.get(c.channel) ?? []), JSON.stringify(c.args).slice(1, -1).replace(/\|/g, '/')])
    channelTable = ['| # | Channel (first call order) | Calls | Arguments |', '|-|-|-|-|',
      ...[...byChannel].map(([ch, args], i) => `| ${i + 1} | ${ch} | ${args.length} | ${args.join(' · ').slice(0, 160)} |`),
      `| | total | ${lastCalls.length} | |`].join('\n')
  })

  it('redraws after a change to the list in the store', async () => {
    const otherRenders: number[] = [], otherCommit: number[] = [], ownRenders: number[] = [], ownCommit: number[] = [], sortedRenders: number[] = []
    for (let run = 0; run < RUNS; run++) {
      setup()
      const rowId = rows[run * 97 + 5]!.row_id
      const view = mount(rowId)
      await untilQuiet()

      // Another record's cell changes (an edit elsewhere, or a save landing)
      profileRenders.n = 0; commitMs = 0
      act(() => { useGridStore.setState(s => ({ rows: s.rows.map(r => r.row_id === rowId + 1 ? { ...r, col_3: `Other ${run}` } : r) })) })
      await untilQuiet()
      otherRenders.push(profileRenders.n); otherCommit.push(commitMs)

      // This record's cell changes (an edit in the details block)
      profileRenders.n = 0; commitMs = 0
      act(() => { useGridStore.setState(s => ({ rows: s.rows.map(r => r.row_id === rowId ? { ...r, col_3: `Own ${run}` } : r) })) })
      await untilQuiet()
      ownRenders.push(profileRenders.n); ownCommit.push(commitMs)

      // The same order stored again as a new array (what DataGrid's setSortedRowIds does after any change)
      profileRenders.n = 0
      act(() => { useGridStore.getState().setSortedRowIds([...sortedIds]) })
      await untilQuiet()
      sortedRenders.push(profileRenders.n)

      view.unmount()
      cleanup()
    }
    record('Another record edited: ProfileView renders (count, not ms)', otherRenders)
    record('Another record edited (React commit time)', otherCommit)
    record('This record edited: ProfileView renders (count, not ms)', ownRenders)
    record('This record edited (React commit time)', ownCommit)
    record('Same sortedRowIds stored again: ProfileView renders (count, not ms)', sortedRenders)
    expect(round(ownRenders[0]!)).toBeGreaterThan(0)
  })
})
