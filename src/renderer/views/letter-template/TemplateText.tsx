import React from 'react'

/**
 * Template text with each {{field}} as a readable chip, so it doesn't look like code.
 * `labels` gives plain names by placeholder ("{{my_name}}" → "Your name"); others are
 * spelled out from the placeholder itself.
 */
export function TemplateText({ content, labels }: { content: string; labels?: Record<string, string> }): React.ReactElement {
  const parts = content.split(/(\{\{[^{}]+\}\})/g)
  return (
    <div className="whitespace-pre-wrap text-base text-slate-800 dark:text-slate-200 leading-relaxed" data-testid="template-text">
      {parts.map((p, i) => {
        const m = p.match(/^\{\{\s*([^{}]+?)\s*\}\}$/)
        if (!m) return <React.Fragment key={i}>{p}</React.Fragment>
        const label = labels?.[`{{${m[1]!}}}`] ?? m[1]!.replace(/^field:/, '').replace(/[_:]+/g, ' ').trim()
        return (
          <span key={i} title={p} className="inline-block px-1.5 mx-0.5 rounded-md border border-blue-300 dark:border-blue-700 bg-blue-50 dark:bg-blue-900/30 text-blue-800 dark:text-blue-200">
            {label}
          </span>
        )
      })}
    </div>
  )
}
