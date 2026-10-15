/**
 * @vitest-environment jsdom
 *
 * The Title placeholder is the workspace's word for the person using Pulse,
 * not a human-services job title (AUDIT-163).
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import React from 'react'
import { render, screen, cleanup } from '@testing-library/react'

Object.defineProperty(window, 'api', { value: { invoke: vi.fn(), on: () => () => {} }, writable: true, configurable: true })

import { ProfileSection } from '../../../../src/renderer/components/settings/ProfileSection'
import { GENERIC_VOCAB } from '../../../../src/shared/vocab'
import { setWords } from '../../vocabFixture'

const noop = (): void => {}
const renderSection = (): void => {
  render(<ProfileSection
    profileName="" setProfileName={noop} profileTitle="" setProfileTitle={noop} profileOrg="" setProfileOrg={noop}
    profileEmail="" setProfileEmail={noop} profilePhone="" setProfilePhone={noop} saveSetting={async () => {}} />)
}

afterEach(() => { cleanup(); setWords() })

describe('ProfileSection', () => {
  it('suggests the worker word as the title', () => {
    setWords()
    renderSection()
    expect((screen.getByLabelText('Title') as HTMLInputElement).placeholder).toBe('Case manager')
  })

  it('suggests a neutral organization and email, not an agency (persona study #14)', () => {
    renderSection()
    expect((screen.getByLabelText('Organization') as HTMLInputElement).placeholder).toBe('Your organization')
    expect((screen.getByLabelText('Email') as HTMLInputElement).placeholder).toBe('name@example.org')
  })

  it('uses general words in a new workspace', () => {
    setWords(GENERIC_VOCAB)
    renderSection()
    expect((screen.getByLabelText('Title') as HTMLInputElement).placeholder).toBe('Worker')
  })
})
