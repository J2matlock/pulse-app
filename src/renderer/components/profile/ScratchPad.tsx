import React, { useCallback, useEffect, useId, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { useEditor, useEditorState, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import DOMPurify from 'dompurify'
import { Bold, Italic, Underline as UnderlineIcon, List, ListOrdered, StickyNote } from 'lucide-react'
import { IPC } from '../../../shared/ipc-channels'
import { safeInvoke } from '../../utils/safeInvoke'
import { expandVariables, detectTrigger, matchSnippets } from '../../utils/snippetExpander'
import { useSettingsStore } from '../../stores/settingsStore'
import type { IPCResult, Snippet } from '../../../shared/types'
import { pulseEvents } from '../../events'
import { rlog } from '../../utils/rendererLogger'
import { useFeature } from '../../hooks/useFeature'
import { modHelp } from '../../utils/keys'
import { useVocab } from '../../hooks/useVocab'

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
  /** The header's words; "Scratch notes" when left out (the Tasks page says whose they are, UX D-32) */
  heading?: string
}

const NO_SNIPPETS: Snippet[] = []

function persistPad(globalScope: string | undefined, rowId: number | undefined, html: string): Promise<IPCResult<unknown>> {
  if (globalScope) return safeInvoke(IPC.GLOBAL_NOTE_UPDATE, globalScope, html)
  if (rowId != null) return safeInvoke(IPC.SCRAP_NOTE_UPDATE, rowId, html)
  return Promise.resolve({ ok: true, data: null })
}

export function ScratchPad({ rowId, clientName, globalScope, snippets: externalSnippets, heading = 'Scratch notes' }: Props) {
  const snippetsOn = useFeature('snippets')
  const { t } = useVocab()
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(false)
  // The saved notes couldn't be read: the pad stays read-only, and nothing is saved over them (Q-047)
  const [loadFailed, setLoadFailed] = useState(false)
  const loadFailedRef = useRef(false)
  // True only once the saved notes are in the editor; until then nothing is saved (R4-01)
  const loadedRef = useRef(false)
  const loadSeqRef = useRef(0)
  const [internalSnippets, setInternalSnippets] = useState<Snippet[]>([])
  // With snippets switched off the "/" menu finds nothing to offer
  const snippets = snippetsOn ? (externalSnippets ?? internalSnippets) : NO_SNIPPETS
  const [snippetMenu, setSnippetMenu] = useState<{ items: Snippet[]; query: string } | null>(null)
  const [snippetMenuPos, setSnippetMenuPos] = useState<{ top: number; left: number; maxWidth: number } | null>(null)
  const [selectedIndex, setSelectedIndex] = useState(-1)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dirtyRef = useRef(false)
  const editorRef = useRef<ReturnType<typeof useEditor>>(null)

  const editorWrapperRef = useRef<HTMLDivElement>(null)

  // Refs so closures inside useEditor always see current values
  const snippetMenuRef = useRef(snippetMenu)
  const selectedIndexRef = useRef(selectedIndex)
  const clientNameRef = useRef(clientName)
  // {today} and {now} follow Settings → Date format and Clock (A21a-09)
  const snippetFormats = { dateFormat: useSettingsStore(s => s.dateFormat), clockFormat: useSettingsStore(s => s.clockFormat) }
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
      if (res.ok && Array.isArray(res.data)) setInternalSnippets(res.data)
    })
  }, [externalSnippets])

  const editor = useEditor({
    extensions: [StarterKit],
    content: '',
    // Read-only until the saved notes are in, so nothing typed lands on an empty pad and is saved over them
    editable: false,
    editorProps: {
      attributes: {
        class: 'scratch-editor max-w-none p-4 min-h-[140px] focus:outline-hidden text-slate-800 dark:text-slate-100',
        style: 'font-size: 15px;',
        spellcheck: 'false',
        // The editor is a textbox; give it a name and say it takes several lines
        role: 'textbox',
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
              const left = Math.max(0, Math.min(Math.max(coords.left - rect.left, 0), rect.width - 220))
              // No wider than the room to the pad's right edge, so it isn't cut off in a narrow column (C-29)
              setSnippetMenuPos({ top, left, maxWidth: Math.max(160, rect.width - left - 8) })
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

      if (loadFailedRef.current || !loadedRef.current) return
      dirtyRef.current = true
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      saveTimerRef.current = setTimeout(async () => {
        saveTimerRef.current = null
        if (loadFailedRef.current || !loadedRef.current) return
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

  const loadPad = useCallback(() => {
    if (!editor) return
    const request = globalScope
      ? safeInvoke<{ content: string } | null>(IPC.GLOBAL_NOTE_GET, globalScope)
      : rowId != null ? safeInvoke<{ content: string } | null>(IPC.SCRAP_NOTE_GET, rowId) : null
    if (!request) return
    // Only the newest load lands (Prev/Next, Try again)
    const seq = ++loadSeqRef.current
    loadedRef.current = false
    // No 'update' event: tiptap emits one by default, which would count as an edit and
    // save the still-empty pad (R4-01)
    editor.setEditable(false, false)
    void request.then(res => {
      if (seq !== loadSeqRef.current) return
      if (!res.ok) {
        // An empty pad here would be saved over the real notes as soon as anyone typed (Q-047)
        rlog.warn('ScratchPad', 'Load failed', res.error)
        loadFailedRef.current = true
        if (saveTimerRef.current) { clearTimeout(saveTimerRef.current); saveTimerRef.current = null }
        dirtyRef.current = false
        setLoadFailed(true)
        editor.commands.setContent('', { emitUpdate: false })
        return
      }
      loadFailedRef.current = false
      setLoadFailed(false)
      editor.commands.setContent(res.data?.content ? sanitizeHtml(res.data.content) : '', { emitUpdate: false })
      loadedRef.current = true
      setLoaded(true)
      editor.setEditable(true, false)
    })
  }, [rowId, globalScope, editor])
  useEffect(() => { loadPad() }, [loadPad])

  // Keep editorRef in sync
  useEffect(() => { editorRef.current = editor }, [editor])

  // The editor doesn't re-render this component on every keystroke, so watch the
  // marks the toolbar shows as pressed (audit A06-18)
  const active = useEditorState({
    editor,
    selector: ({ editor: ed }) => ({
      bold: ed?.isActive('bold') ?? false,
      italic: ed?.isActive('italic') ?? false,
      underline: ed?.isActive('underline') ?? false,
      bulletList: ed?.isActive('bulletList') ?? false,
      orderedList: ed?.isActive('orderedList') ?? false,
      empty: ed?.isEmpty ?? true,
    }),
  })

  // The "/" menu is a listbox the editor points at, so a screen reader hears the
  // highlighted snippet (audit A06-32). ProseMirror leaves attributes it didn't set alone.
  const menuId = useId()
  const optionId = (i: number) => `${menuId}-opt-${i}`
  const menuOpen = !!snippetMenu && snippetMenu.items.length > 0
  useEffect(() => {
    const dom = editor?.view?.dom
    if (!dom || typeof dom.setAttribute !== 'function') return
    if (menuOpen) dom.setAttribute('aria-controls', menuId)
    else dom.removeAttribute('aria-controls')
    if (menuOpen && selectedIndex >= 0) dom.setAttribute('aria-activedescendant', `${menuId}-opt-${selectedIndex}`)
    else dom.removeAttribute('aria-activedescendant')
  }, [editor, menuOpen, selectedIndex, menuId])

  // Save what's pending right away instead of waiting for the timer. Runs when the
  // pad goes away (Prev/Next, leaving the page) and just before the app locks,
  // while the database is still open (1.2).
  const flushNow = useCallback(() => {
    if (saveTimerRef.current) { clearTimeout(saveTimerRef.current); saveTimerRef.current = null }
    if (!dirtyRef.current || !editorRef.current || loadFailedRef.current || !loadedRef.current) return
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
    const expanded = expandVariables(snippet.expansion, clientNameRef.current, snippetFormats)
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

  function toolbarBtn(pressed: boolean, onClick: () => void, icon: React.ReactNode, title: string) {
    return (
      <button
        type="button"
        // mousedown keeps the editor's selection; the click (or Enter/Space) does the work
        onMouseDown={e => e.preventDefault()}
        onClick={onClick}
        title={title}
        aria-label={title}
        aria-pressed={pressed}
        className={`hit-44 p-1.5 rounded-sm text-base transition-colors
          ${pressed ? 'bg-slate-200 dark:bg-slate-600 text-slate-800 dark:text-slate-100' : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-slate-700 dark:hover:text-slate-200'}
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
        <span className="text-sm font-medium text-slate-600 dark:text-slate-300 flex-1">{heading}</span>
        {saving && <span className="text-sm text-slate-500 dark:text-slate-400 italic">Saving…</span>}
        {saveError && !saving && <span role="alert" className="text-base text-red-700 dark:text-red-400">We couldn't save this — keep typing to try again</span>}
      </div>
      {loadFailed && (
        <div role="alert" className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 text-base text-red-800 dark:text-red-300">
          <span className="flex-1">We couldn't load the scratch notes, so they can't be edited right now. What was saved is still there.</span>
          <button type="button" className="btn-secondary" onClick={loadPad}>Try again</button>
        </div>
      )}

      <div role="toolbar" aria-label="Text formatting" className="flex flex-wrap items-center gap-0.5 px-2 py-1 border-b border-slate-100 dark:border-slate-700/50">
        {toolbarBtn(active?.bold ?? false, () => editor?.chain().focus().toggleBold().run(), <Bold className="w-4 h-4" />, modHelp('Bold (Ctrl+B)'))}
        {toolbarBtn(active?.italic ?? false, () => editor?.chain().focus().toggleItalic().run(), <Italic className="w-4 h-4" />, modHelp('Italic (Ctrl+I)'))}
        {toolbarBtn(active?.underline ?? false, () => editor?.chain().focus().toggleUnderline().run(), <UnderlineIcon className="w-4 h-4" />, modHelp('Underline (Ctrl+U)'))}
        <div className="w-px h-5 bg-slate-200 dark:bg-slate-600 mx-1" aria-hidden="true" />
        {toolbarBtn(active?.bulletList ?? false, () => editor?.chain().focus().toggleBulletList().run(), <List className="w-4 h-4" />, modHelp('Bullet list (Ctrl+Shift+8)'))}
        {toolbarBtn(active?.orderedList ?? false, () => editor?.chain().focus().toggleOrderedList().run(), <ListOrdered className="w-4 h-4" />, modHelp('Numbered list (Ctrl+Shift+7)'))}
        {/* Only once there's a snippet to find (UX D-32) */}
        {snippetsOn && snippets.length > 0 && <div className="ml-2 text-base text-slate-500 dark:text-slate-400 whitespace-nowrap">Type / for snippets</div>}
      </div>

      {/* onKeyDownCapture fires before tiptap sees the event */}
      <div
        data-scratchpad-wrap
        ref={editorWrapperRef}
        // The editor itself draws no outline, so the box around it shows keyboard focus
        className="relative overflow-auto focus-within:ring-3 focus-within:ring-inset focus-within:ring-blue-500"
        style={{ minHeight: 140, maxHeight: 600 }}
        onKeyDownCapture={handleKeyDownCapture}
      >
        <EditorContent editor={editor} />
        {/* What the pad is for, until something's written in it (C-9): only on a record's page */}
        {!globalScope && loaded && !loadFailed && (active?.empty ?? true) && (
          <p aria-hidden="true" className="absolute top-0 left-0 right-0 p-4 pointer-events-none text-base text-slate-500 dark:text-slate-400">
            Private jottings for you — reminders, numbers, things to ask. Not part of the {t('activityLog')}, and left out of printouts unless you choose to include them.
          </p>
        )}

        <span role="status" className="sr-only">
          {menuOpen ? `${snippetMenu.items.length} ${snippetMenu.items.length === 1 ? 'snippet matches' : 'snippets match'}. Tab inserts the first, or the one you choose with the up and down arrows.` : ''}
        </span>

        {snippetMenu && snippetMenu.items.length > 0 && (
          <div
            className="absolute z-50 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-lg shadow-lg py-1 max-w-72"
            style={snippetMenuPos
              ? { top: snippetMenuPos.top, left: snippetMenuPos.left, maxWidth: Math.min(288, snippetMenuPos.maxWidth) }
              : { left: 4, right: 4, top: '100%', marginTop: 4 }}
          >
            <div id={menuId} role="listbox" aria-label="Snippets">
            {snippetMenu.items.map((s, i) => (
              <div
                key={s.id}
                id={optionId(i)}
                role="option"
                aria-selected={i === selectedIndex}
                onMouseDown={e => { e.preventDefault(); applySnippet(s) }}
                className={`hit-44 flex items-start gap-2 w-full px-3 py-2 text-left cursor-pointer
                  ${i === selectedIndex
                    ? 'bg-blue-100 dark:bg-blue-900/40'
                    : 'hover:bg-blue-50 dark:hover:bg-blue-900/20'
                  }`}
              >
                <span className="text-sm font-mono text-blue-700 dark:text-blue-300 flex-shrink-0">/{s.trigger_text}</span>
                <span className="text-sm text-slate-500 dark:text-slate-400 truncate">{s.expansion.slice(0, 40)}</span>
              </div>
            ))}
            </div>
            <div aria-hidden="true" className="px-3 py-1 border-t border-slate-100 dark:border-slate-700 mt-1">
              <span className="text-base text-slate-500 dark:text-slate-400">Tab inserts · ↑↓ then Enter to pick another · Esc closes</span>
            </div>
          </div>
        )}
      </div>
    </section>
  )
}
