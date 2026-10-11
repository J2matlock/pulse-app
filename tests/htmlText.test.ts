/** Rich text to plain text for exports and printouts (AUDIT-069). */
import { describe, it, expect } from 'vitest'
import { htmlToText } from '../src/shared/htmlText'

describe('htmlToText', () => {
  it('keeps paragraphs, line breaks, list items and headings apart', () => {
    expect(htmlToText('<p>Call Mom</p><p>Bring forms</p>')).toBe('Call Mom\nBring forms')
    expect(htmlToText('<ul><li><p>One</p></li><li><p>Two</p></li></ul>')).toBe('One\n\nTwo')
    expect(htmlToText('<h2>Plan</h2><p>Line one<br>Line two</p>')).toBe('Plan\nLine one\nLine two')
    expect(htmlToText('<p>Hello <strong>World</strong></p>')).toBe('Hello World')
  })

  it('decodes entities once, so escaped text stays escaped', () => {
    expect(htmlToText('&amp;lt;b&amp;gt;')).toBe('&lt;b&gt;')
    expect(htmlToText('Tom &amp; Jerry &lt;3 &quot;hi&quot; &#39;x&#39; a&nbsp;b')).toBe('Tom & Jerry <3 "hi" \'x\' a b')
  })

  it('decodes characters past U+FFFF, like emoji', () => {
    expect(htmlToText('&#128512; &#x1F600;')).toBe('\u{1F600} \u{1F600}')
  })

  it('leaves unknown or invalid entities and plain text alone', () => {
    expect(htmlToText('&bogus; &#xFFFFFFF;')).toBe('&bogus; &#xFFFFFFF;')
    expect(htmlToText('plain\nnote')).toBe('plain\nnote')
    expect(htmlToText('')).toBe('')
  })
})
