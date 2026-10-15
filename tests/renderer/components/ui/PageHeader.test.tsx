// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { PageHeader } from '../../../../src/renderer/components/ui/PageHeader'
import { Section } from '../../../../src/renderer/components/ui/Section'

afterEach(() => cleanup())

describe('PageHeader', () => {
  it('draws a 20 px title, the sentence under it, and the actions with the main one last', () => {
    render(<PageHeader title="Tasks" description="Things to do." data-tour="tasks-header"
      actions={<button>Add a group</button>} primary={<button>Add task</button>} breadcrumb={<nav aria-label="Breadcrumb">Dashboard</nav>} />)
    const h1 = screen.getByRole('heading', { level: 1, name: 'Tasks' })
    expect(h1.className).toMatch(/text-2xl/)
    expect(screen.getByText('Things to do.').className).toMatch(/text-base/)
    const buttons = screen.getAllByRole('button').map(b => b.textContent)
    expect(buttons).toEqual(['Add a group', 'Add task'])
    expect(screen.getByRole('banner').getAttribute('data-tour')).toBe('tasks-header')
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toBeTruthy()
  })

  it('has no action area when there are no actions', () => {
    const { container } = render(<PageHeader title="Help" />)
    expect(container.querySelectorAll('header > div')).toHaveLength(1)
  })
})

describe('Section', () => {
  it('is a section named by its 18 px heading, with no border', () => {
    render(<Section title="Backups" description="Where copies go." actions={<button>Back up now</button>} data-testid="s">
      <p>Body</p>
    </Section>)
    const section = screen.getByRole('region', { name: 'Backups' })
    expect(section.getAttribute('data-testid')).toBe('s')
    expect(section.className).not.toMatch(/(^| )border/)
    expect(screen.getByRole('heading', { level: 2, name: 'Backups' }).className).toMatch(/text-xl/)
    expect(screen.getByText('Body')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Back up now' })).toBeTruthy()
  })
})
