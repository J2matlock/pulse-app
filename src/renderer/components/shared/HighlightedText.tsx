import React from 'react'

interface HighlightedTextProps {
  text: string
  highlight: string
  activeIndex?: number
  className?: string
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function HighlightedText({ text, highlight, activeIndex, className }: HighlightedTextProps): React.ReactElement {
  if (!highlight || !text) {
    return <span className={className}>{text}</span>
  }

  const regex = new RegExp(`(${escapeRegex(highlight)})`, 'gi')
  const parts = text.split(regex)
  let matchIdx = 0

  return (
    <span className={className}>
      {parts.map((part, i) => {
        if (regex.test(part)) {
          // Reset regex lastIndex since we used test() with global flag
          regex.lastIndex = 0
          const isActive = matchIdx === activeIndex
          matchIdx++
          return (
            <mark key={i} className={`search-mark ${isActive ? 'search-mark-active' : ''}`}>
              {part}
            </mark>
          )
        }
        // Reset regex lastIndex
        regex.lastIndex = 0
        return <span key={i}>{part}</span>
      })}
    </span>
  )
}
