import React, { useCallback, useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import DOMPurify from 'dompurify'
import { Bold, Italic, Underline as UnderlineIcon, List, ListOrdered, StickyNote } from 'lucide-react'
import { IPC } from '../../../shared/ipc-channels'
import { safeInvoke } from '../../utils/safeInvoke'
import { expandVariables, detectTrigger, matchSnippets } from '../../utils/snippetExpander'
import type { IPCResult, Snippet } from '../../../shared/types'
import { pulseEvents } from '../../events'
import { rlog } from '../../utils/rendererLogger'
import { useFeature } from '../../hooks/useFeature'
import { modHelp } from '../../utils/keys'

/** Sanitize HTML before loading into tiptap to prevent XSS from corrupted data */
function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'u', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'code', 'pre', 'hr'],
    ALLOWED_ATTR: [],
  })
}

interface Props {
  rowId?: number
  clientName?: string
  /** When set, uses global_notes table (keyed by scope) instead of scrap_notes (keyed by rowId) */
  globalScope?: string
  /** Pre-loaded snippets from parent (avoids duplicate fetch when CaseLog also needs them) */
  snippets?: Snippet[]
}

const NO_SNIPPETS: Snippet[] = []

function persistPad(globalScope: string | undefined, rowId: number | undefined, html: string): Promise<IPCResult<unknown>> {
  if (globalScope) return safeInvoke(IPC.GLOBAL_NOTE_UPDATE, globalScope, html)
  if (rowId != null) return safeInvoke(IPC.SCRAP_NOTE_UPDATE, rowId, html)
  return Promise.resolve({ ok: true, data: null })
}

export function ScratchPad({ rowId, clientName, globalScope, snippets: externalSnippets }: Props) {
  const snippetsOn = useFeature('snippets')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(false)
  const [internalSnippets, setInternalSnippets] = useState<Snippet[]>([])
  // With snippets switched off the "/" menu finds nothing to offer
  const snippets = snippetsOn ? (externalSnippets ?? internalSnippets) : NO_SNIPPETS
  const [snippetMenu, setSnippetMenu] = useState<{ items: Snippet[]; query: string } | null>(null)
  const [snippetMenuPos, setSnippetMenuPos] = useState<{ top: number; left: number } | null>(null)
  const [selectedIndex, setSelectedIndex] = useState(-1)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dirtyRef = useRef(false)
  const editorRef = useRef<ReturnType<typeof useEditor>>(null)

  const editorWrapperRef = useRef<HTMLDivElement>(null)

  // Refs so closures inside useEditor always see current values
  const snippetMenuRef = useRef(snippetMenu)
  const selectedIndexRef = useRef(selectedIndex)
  const clientNameRef = useRef(clientName)
  const rowIdRef = useRef(rowId)
  const globalScopeRef = useRef(globalScope)
  useEffect(() => { snippetMenuRef.current = snippetMenu }, [snippetMenu])
  useEffect(() => { selectedIndexRef.current = selectedIndex }, [selectedIndex])
  useEffect(() => { clientNameRef.current = clientName }, [clientName])
  useEffect(() => { rowIdRef.current = rowId }, [rowId])
  useEffect(() => { globalScopeRef.current = globalScope }, [globalScope])

  // Reset selection when menu contents change
  useEffect(() => { setSelectedIndex(-1) }, [snippetMenu?.items.length])

  useEffect(() => {
    if (externalSnippets) return // Skip fetch when parent provides snippets
    safeInvoke<Snippet[]>(IPC.SNIPPET_GET_ALL).then(res => {
      if (res.ok) setInternalSnippets(res.data)
    })
  }, [externalSnippets])

  const editor = useEditor({
    extensions: [StarterKit],
    content: '',
    editorProps: {
      attributes: {
        class: 'prose prose-sm dark:prose-invert max-w-none p-4 min-h-[140px] focus:outline-hidden text-slate-800 dark:text-slate-100',
        style: 'font-size: 15px;',
        spellcheck: 'false',
        // The editor is a textbox; give it a name and say it takes several lines
        'aria-label': 'Scratch notes',
        'aria-multiline': 'true',
      },
      transformPastedHTML(html: string) {
        return sanitizeHtml(html)
      },
    },
    onUpdate: ({ editor }) => {
      const { state } = editor
      const { from } = state.selection
      const textBefore = state.doc.textBetween(Math.max(0, from - 50), from, '\n', '\0')
      const match = detectTrigger(textBefore)
      if (match) {
        const matched = matchSnippets(snippets, match.query)
        if (matched.length > 0) {
          setSnippetMenu({ items: matched, query: match.query })
          // Position menu near cursor using tiptap's coord resolution
          try {
            const coords = editor.view.coordsAtPos(from)
            const editorEl = editor.view.dom.closest('[data-scratchpad-wrap]') ?? editor.view.dom.parentElement
            const rect = editorEl?.getBoundingClientRect()
            if (rect) {
              const top = Math.min(coords.bottom - rect.top + 4, rect.height - 200)
              const left = Math.min(Math.max(coords.left - rect.left, 0), rect.width - 220)
              setSnippetMenuPos({ top, left })
            }
          } catch { /* non-fatal — fall back to default position */ }
        } else {
          setSnippetMenu(null)
          setSnippetMenuPos(null)
        }
      } else {
        setSnippetMenu(null)
        setSnippetMenuPos(null)
      }

      dirtyRef.current = true
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      saveTimerRef.current = setTimeout(async () => {
        saveTimerRef.current = null
        setSaving(true)
        // Anything typed while this save is on its way marks the pad dirty again
        dirtyRef.current = false
        const res = await persistPad(globalScopeRef.current, rowIdRef.current, sanitizeHtml(editor.getHTML()))
        setSaving(false)
        if (res.ok) setSaveError(false)
        else {
          rlog.warn('ScratchPad', 'Save failed', res.error)
          dirtyRef.current = true
          setSaveError(true)
        }
      }, 2000)
    },
  })

  useEffect(() => {
    if (!editor) return
    if (globalScope) {
      safeInvoke<{ content: string }>(IPC.GLOBAL_NOTE_GET, globalScope).then(res => {
        if (res.ok && res.data?.content) {
          editor.commands.setContent(sanitizeHtml(res.data.content), { emitUpdate: false })
        } else {
          editor.commands.setContent('', { emitUpdate: false })
        }
      })
    } else if (rowId != null) {
      safeInvoke<{ content: string }>(IPC.SCRAP_NOTE_GET, rowId).then(res => {
        if (res.ok && res.data?.content) {
          editor.commands.setContent(sanitizeHtml(res.data.content), { emitUpdate: false })
        } else {
          editor.commands.setContent('', { emitUpdate: false })
        }
      })
    }
  }, [rowId, globalScope, editor])

  // Keep editorRef in sync
  useEffect(() => { editorRef.current = editor }, [editor])

  // Save what's pending right away instead of waiting for the timer. Runs when the
  // pad goes away (Prev/Next, leaving the page) and just before the app locks,
  // while the database is still open (1.2).
  const flushNow = useCallback(() => {
    if (saveTimerRef.current) { clearTimeout(saveTimerRef.current); saveTimerRef.current = null }
    if (!dirtyRef.current || !editorRef.current) return
    dirtyRef.current = false
    void persistPad(globalScopeRef.current, rowIdRef.current, sanitizeHtml(editorRef.current.getHTML())).then(res => {
      if (!res.ok) toast.error('We couldn\'t save your last changes to the scratch notes. Please check them and try again.')
    })
  }, [])
  useEffect(() => pulseEvents.on('app:locking', flushNow), [flushNow])
  useEffect(() => flushNow, [flushNow])

  function applySnippet(snippet: Snippet) {
    if (!editor) return
    const { state } = editor
    const { from } = state.selection
    const textBefore = state.doc.textBetween(Math.max(0, from - 50), from, '\n', '\0')
    const match = detectTrigger(textBefore)
    if (!match) return
    const expanded = expandVariables(snippet.expansion, clientNameRef.current)
    // Insert as plain text to prevent XSS via snippet content containing HTML
    editor.chain().focus().deleteRange({ from: from - match.trigger.length, to: from }).insertContent({ type: 'text', text: expanded }).run()
    setSnippetMenu(null)
    setSelectedIndex(-1)
  }

  // Intercept keyboard events BEFORE tiptap processes them (capture phase)
  function handleKeyDownCapture(e: React.KeyboardEvent) {
    const menu = snippetMenuRef.current
    if (!menu || menu.items.length === 0) return

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex(i => Math.min(i + 1, menu.items.length - 1))
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex(i => Math.max(i - 1, 0))
      return
    }
    // Enter picks a snippet only once one was chosen with the arrow keys; otherwise it's a new line
    if (e.key === 'Tab' || (e.key === 'Enter' && selectedIndexRef.current >= 0)) {
      e.preventDefault()
      const idx = selectedIndexRef.current >= 0 ? selectedIndexRef.current : 0
      applySnippet(menu.items[idx]!)
      return
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      setSnippetMenu(null)
      setSelectedIndex(-1)
    }
  }

  function toolbarBtn(active: boolean, onClick: () => void, icon: React.ReactNode, title: string) {
    return (
      <button
        type="button"
        onMouseDown={e => { e.preventDefault(); onClick() }}
        title={title}
        className={`hit-44 p-1.5 rounded-sm text-base transition-colors
          ${active ? 'bg-slate-200 dark:bg-slate-600 text-slate-800 dark:text-slate-100' : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-slate-700 dark:hover:text-slate-200'}
          focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500`}
      >
        {icon}
      </button>
    )
  }

  return (
    <section className="rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden bg-white dark:bg-slate-800">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-700/50">
        <StickyNote className="w-4 h-4 text-slate-500 dark:text-slate-400 flex-shrink-0" />
        <span className="text-sm font-medium text-slate-600 dark:text-slate-300 flex-1">Scratch notes</span>
        {saving && <span className="text-sm text-slate-500 dark:text-slate-400 italic">Saving…</span>}
        {saveError && !saving && <span role="alert" className="text-base text-red-700 dark:text-red-400">We couldn't save this — keep typing to try again</span>}
      </div>

      <div className="flex flex-wrap items-center gap-0.5 px-2 py-1 border-b border-slate-100 dark:border-slate-700/50">
        {toolbarBtn(editor?.isActive('bold') ?? false, () => editor?.chain().focus().toggleBold().run(), <Bold className="w-4 h-4" />, modHelp('Bold (Ctrl+B)'))}
        {toolbarBtn(editor?.isActive('italic') ?? false, () => editor?.chain().focus().toggleItalic().run(), <Italic className="w-4 h-4" />, modHelp('Italic (Ctrl+I)'))}
        {toolbarBtn(editor?.isActive('underline') ?? false, () => editor?.chain().focus().toggleUnderline().run(), <UnderlineIcon className="w-4 h-4" />, modHelp('Underline (Ctrl+U)'))}
        <div className="w-px h-5 bg-slate-200 dark:bg-slate-600 mx-1" />
        {toolbarBtn(editor?.isActive('bulletList') ?? false, () => editor?.chain().focus().toggleBulletList().run(), <List className="w-4 h-4" />, modHelp('Bullet list (Ctrl+Shift+8)'))}
        {toolbarBtn(editor?.isActive('orderedList') ?? false, () => editor?.chain().focus().toggleOrderedList().run(), <ListOrdered className="w-4 h-4" />, modHelp('Numbered list (Ctrl+Shift+7)'))}
        {snippetsOn && <div className="ml-2 text-base text-slate-500 dark:text-slate-400 whitespace-nowrap">Type / for snippets</div>}
      </div>

      {/* onKeyDownCapture fires before tiptap sees the event */}
      <div
        data-scratchpad-wrap
        ref={editorWrapperRef}
        className="relative overflow-auto"
        style={{ minHeight: 140, maxHeight: 600 }}
        onKeyDownCapture={handleKeyDownCapture}
      >
        <EditorContent editor={editor} />

        {snippetMenu && snippetMenu.items.length > 0 && (
          <div
            className="absolute z-50 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-lg shadow-lg py-1 min-w-52 max-w-72"
            style={snippetMenuPos ? { top: snippetMenuPos.top, left: snippetMenuPos.left } : { left: 4, top: '100%', marginTop: 4 }}
          >
            {snippetMenu.items.map((s, i) => (
              <button
                key={s.id}
                type="button"
                onMouseDown={e => { e.preventDefault(); applySnippet(s) }}
                className={`hit-44 flex items-start gap-2 w-full px-3 py-2 text-left
                  focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-blue-500
                  ${i === selectedIndex
                    ? 'bg-blue-100 dark:bg-blue-900/40'
                    : 'hover:bg-blue-50 dark:hover:bg-blue-900/20'
                  }`}
              >
                <span className="text-sm font-mono text-blue-700 dark:text-blue-300 flex-shrink-0">/{s.trigger_text}</span>
                <span className="text-sm text-slate-500 dark:text-slate-400 truncate">{s.expansion.slice(0, 40)}</span>
              </button>
            ))}
            <div className="px-3 py-1 border-t border-slate-100 dark:border-slate-700 mt-1">
              <span className="text-base text-slate-500 dark:text-slate-400">Tab inserts · ↑↓ then Enter to pick another · Esc closes</span>
            </div>
          </div>
        )}
      </div>
    </section>
  )
}
