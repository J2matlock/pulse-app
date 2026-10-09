// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'

const mockInvoke = vi.fn().mockResolvedValue({ ok: true, data: null })
Object.defineProperty(window, 'api', {
  value: { invoke: mockInvoke },
  writable: true,
})

if (!globalThis.crypto?.randomUUID) {
  vi.stubGlobal('crypto', { randomUUID: () => 'test-uuid-' + Math.random().toString(36).slice(2) })
}

vi.mock('motion/react', () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  motion: {
    div: React.forwardRef((props: Record<string, unknown>, ref: React.Ref<HTMLDivElement>) => {
      const { variants, initial, animate, exit, ...rest } = props
      return <div ref={ref} {...rest} />
    }),
  },
}))

vi.mock('../../../../src/renderer/utils/animations', () => ({
  contextMenuVariants: {},
}))

vi.mock('../../../../src/renderer/utils/safeInvoke', () => ({
  safeInvoke: vi.fn().mockResolvedValue({ ok: true, data: null }),
}))

vi.mock('../../../../src/renderer/utils/rendererLogger', () => ({
  rlog: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

vi.mock('react-hot-toast', () => ({
  default: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }),
}))

import { GroupHeaderItem, CollapseExpandBar, GroupContextMenuOverlay } from '../../../../src/renderer/components/grid/GridGroupHeader'
import { setWords } from '../../vocabFixture'

beforeEach(() => { setWords() })

describe('GroupHeaderItem', () => {
  it('renders group value and count', () => {
    render(
      <GroupHeaderItem
        value="Active"
        count={5}
        groupKey="active"
        isCollapsed={false}
        height={44}
        onToggle={vi.fn()}
        onContextMenu={vi.fn()}
      />
    )
    expect(screen.getByText('Active')).toBeTruthy()
    expect(screen.getByText('5 clients')).toBeTruthy()
  })

  it('shows singular for count of 1', () => {
    render(
      <GroupHeaderItem value="Solo" count={1} groupKey="solo" isCollapsed={false} height={44} onToggle={vi.fn()} onContextMenu={vi.fn()} />
    )
    expect(screen.getByText('1 client')).toBeTruthy()
  })

  it('shows (empty) for blank value', () => {
    render(
      <GroupHeaderItem value="" count={2} groupKey="" isCollapsed={false} height={44} onToggle={vi.fn()} onContextMenu={vi.fn()} />
    )
    expect(screen.getByText('(empty)')).toBeTruthy()
  })

  it('clicking toggle calls onToggle with groupKey', () => {
    const onToggle = vi.fn()
    render(
      <GroupHeaderItem value="Test" count={3} groupKey="test-key" isCollapsed={false} height={44} onToggle={onToggle} onContextMenu={vi.fn()} />
    )
    fireEvent.click(screen.getByTitle('Collapse group'))
    expect(onToggle).toHaveBeenCalledWith('test-key')
  })
})

describe('CollapseExpandBar', () => {
  it('renders Collapse all and Expand all buttons', () => {
    render(<CollapseExpandBar onCollapseAll={vi.fn()} onExpandAll={vi.fn()} />)
    expect(screen.getByText('Collapse all')).toBeTruthy()
    expect(screen.getByText('Expand all')).toBeTruthy()
  })

  it('clicking Collapse all calls handler', () => {
    const onCollapseAll = vi.fn()
    render(<CollapseExpandBar onCollapseAll={onCollapseAll} onExpandAll={vi.fn()} />)
    fireEvent.click(screen.getByText('Collapse all'))
    expect(onCollapseAll).toHaveBeenCalled()
  })
})

describe('GroupContextMenuOverlay', () => {
  it('returns null when position is null', () => {
    const { container } = render(
      <GroupContextMenuOverlay position={null} isGrouped={true} onCollapseAll={vi.fn()} onExpandAll={vi.fn()} onClose={vi.fn()} />
    )
    expect(container.firstChild).toBeNull()
  })
})
