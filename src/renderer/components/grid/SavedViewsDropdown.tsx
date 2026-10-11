import { useRef, useState } from 'react'
import { clampLeft } from '../../utils/domHelpers'
import { AnimatePresence, motion } from 'motion/react'
import { Layers, Trash2, Plus, X } from 'lucide-react'
import { TOOLBAR_ICON, TOOLBAR_LABEL } from './gridConstants'
import { useShallow } from 'zustand/react/shallow'
import { useGridStore } from '../../stores/gridStore'
import { dropdownVariants } from '../../utils/animations'

export function SavedViewsDropdown() {
  const { savedViews } = useGridStore(useShallow(s => ({
    savedViews: s.savedViews,
  })))
  const { saveCurrentView, applySavedView, deleteSavedView } = useGridStore(useShallow(s => ({
    saveCurrentView: s.saveCurrentView,
    applySavedView: s.applySavedView,
    deleteSavedView: s.deleteSavedView,
  })))

  const btnRef = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [name, setName] = useState('')

  const handleApply = (id: number) => {
    applySavedView(id)
    setOpen(false)
  }

  const handleDelete = (e: React.MouseEvent, id: number) => {
    e.stopPropagation()
    deleteSavedView(id)
  }

  const handleSave = () => {
    const trimmed = name.trim()
    if (!trimmed) return
    saveCurrentView(trimmed)
    setName('')
    setSaving(false)
    setOpen(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleSave()
    } else if (e.key === 'Escape') {
      setSaving(false)
      setName('')
    }
  }

  const rect = btnRef.current?.getBoundingClientRect()

  return (
    <div>
      <button
        ref={btnRef}
        className={`btn-secondary ${open ? 'bg-purple-50 dark:bg-purple-900/30' : ''}`}
        style={{ minHeight: 36, padding: '0 12px', fontSize: 15, display: 'flex', alignItems: 'center', gap: 6 }}
        title="Views"
        onClick={() => {
          setOpen(prev => !prev)
          setSaving(false)
          setName('')
        }}
      >
        <Layers size={16} className={TOOLBAR_ICON} />
        <span className={TOOLBAR_LABEL}>Views</span>
        {savedViews.length > 0 && (
          <span
            className="bg-purple-500 text-white text-sm"
            style={{
              borderRadius: 9999,
              minWidth: 18,
              height: 18,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '0 5px',
              fontWeight: 600,
              lineHeight: 1,
            }}
          >
            {savedViews.length}
          </span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <>
            {/* Backdrop */}
            <div
              style={{ position: 'fixed', inset: 0, zIndex: 40 }}
              onClick={() => {
                setOpen(false)
                setSaving(false)
                setName('')
              }}
            />

            {/* Panel */}
            <motion.div
              className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700"
              style={{
                position: 'fixed',
                top: rect ? rect.bottom + 4 : 100,
                left: rect ? clampLeft(rect.left, 320) : 0,
                width: 320,
                borderRadius: 8,
                boxShadow: '0 20px 25px -5px rgba(0,0,0,.1), 0 8px 10px -6px rgba(0,0,0,.1)',
                zIndex: 50,
              }}
              variants={dropdownVariants}
              initial="hidden" animate="visible" exit="exit"
            >
              {/* Header */}
              <div
                className="text-gray-500 dark:text-gray-400"
                style={{
                  fontSize: 15,
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  padding: '10px 12px 6px',
                }}
              >
                Saved Views
              </div>

              {/* View list */}
              {savedViews.length === 0 ? (
                <div
                  className="text-gray-500 dark:text-gray-400"
                  style={{ padding: '16px 12px', fontSize: 15, textAlign: 'center' }}
                >
                  No saved views yet
                </div>
              ) : (
                <div style={{ maxHeight: 240, overflowY: 'auto' }}>
                  {savedViews.map(view => (
                    <div
                      key={view.id}
                      className="hover:bg-gray-100 dark:hover:bg-slate-700 cursor-pointer"
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        minHeight: 44,
                        padding: '0 12px',
                        fontSize: 15,
                      }}
                      onClick={() => handleApply(view.id)}
                    >
                      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {view.name}
                      </span>
                      <button
                        className="text-gray-500 hover:text-red-500 dark:text-gray-400 dark:hover:text-red-400"
                        style={{
                          minWidth: 44,
                          minHeight: 44,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          background: 'none',
                          border: 'none',
                          cursor: 'pointer',
                          flexShrink: 0,
                        }}
                        onClick={(e) => handleDelete(e, view.id)}
                        title="Delete view"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Separator */}
              <div className="border-t border-gray-200 dark:border-slate-700" />

              {/* Save section */}
              <div style={{ padding: '8px 12px' }}>
                {!saving ? (
                  <button
                    className="text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-slate-700"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      width: '100%',
                      minHeight: 44,
                      padding: '0 8px',
                      fontSize: 15,
                      background: 'none',
                      border: 'none',
                      borderRadius: 6,
                      cursor: 'pointer',
                    }}
                    onClick={() => setSaving(true)}
                  >
                    <Plus size={16} />
                    Save current view...
                  </button>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <input
                      type="text"
                      className="bg-white dark:bg-slate-900 border border-gray-300 dark:border-slate-600 text-gray-900 dark:text-gray-100"
                      style={{
                        flex: 1,
                        minWidth: 0,
                        height: 36,
                        padding: '0 8px',
                        fontSize: 15,
                        borderRadius: 6,
                        outline: 'none',
                      }}
                      placeholder="View name"
                      value={name}
                      onChange={e => setName(e.target.value)}
                      onKeyDown={handleKeyDown}
                      autoFocus
                    />
                    <button
                      className="btn-secondary"
                      style={{ minHeight: 36, padding: '0 10px', fontSize: 15, flexShrink: 0 }}
                      onClick={handleSave}
                      disabled={!name.trim()}
                    >
                      Save
                    </button>
                    <button
                      className="hit-44 text-gray-500 dark:text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                      style={{
                        width: 28,
                        height: 28,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        flexShrink: 0,
                      }}
                      onClick={() => {
                        setSaving(false)
                        setName('')
                      }}
                      title="Cancel"
                    >
                      <X size={16} />
                    </button>
                  </div>
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}
