import { useState, useEffect, useRef } from 'react'
import { motion } from 'motion/react'
import { X as XIcon, Pencil, Trash2, Check, Plus } from 'lucide-react'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import { backdropVariants, modalPanelVariants } from '../../utils/animations'
import { useShallow } from 'zustand/react/shallow'
import { useContactsStore } from '../../stores/contactsStore'
import { normalizeHexColor } from '../../../shared/color'


const PRESET_COLORS = [
  '#3b82f6', '#8b5cf6', '#f59e0b', '#22c55e',
  '#ef4444', '#14b8a6', '#f97316', '#6366f1',
  '#f43f5e', '#64748b', '#ec4899', '#84cc16',
]

export function CategoryManager({ open, onClose }: { open: boolean; onClose: () => void }) {
  const trapRef = useRef<HTMLDivElement>(null)
  useFocusTrap(trapRef, open)
  const { categories, createCategory, updateCategory, deleteCategory, customFields, loadCustomFields, createCustomField, deleteCustomField } = useContactsStore(useShallow(s => ({
    categories: s.categories,
    createCategory: s.createCategory,
    updateCategory: s.updateCategory,
    deleteCategory: s.deleteCategory,
    customFields: s.customFields,
    loadCustomFields: s.loadCustomFields,
    createCustomField: s.createCustomField,
    deleteCustomField: s.deleteCustomField,
  })))

  const [editingId, setEditingId] = useState<number | null>(null)
  const [editName, setEditName] = useState('')
  const [editColor, setEditColor] = useState('')
  const [colorError, setColorError] = useState(false)
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState('#6b7280')
  const [deletingId, setDeletingId] = useState<number | null>(null)
  const [newFieldName, setNewFieldName] = useState('')
  const [newFieldType, setNewFieldType] = useState<string>('text')

  // Load custom fields when editing a category
  useEffect(() => {
    if (editingId != null) loadCustomFields(editingId)
  }, [editingId, loadCustomFields])

  function startEdit(id: number, name: string, color: string) {
    setEditingId(id)
    setEditName(name)
    setEditColor(color)
    setColorError(false)
    setDeletingId(null)
  }

  async function commitEdit() {
    if (editingId === null || !editName.trim()) return
    // Only a hex colour can be printed on the directory PDF, so "red" or "#ab" stays in the box.
    const color = normalizeHexColor(editColor)
    if (!color) { setColorError(true); return }
    await updateCategory(editingId, { name: editName.trim(), color })
    setEditingId(null)
  }

  async function handleDelete(id: number) {
    await deleteCategory(id)
    setDeletingId(null)
  }

  async function handleAdd() {
    if (!newName.trim()) return
    const created = await createCategory(newName.trim(), newColor)
    // Keep the name on failure so it can be tried again.
    if (!created) return
    setNewName('')
    setNewColor('#6b7280')
  }

  return (
    <>
    {open && (
    <div ref={trapRef} className="fixed inset-0 z-50 flex items-center justify-center" role="dialog" aria-modal="true" aria-labelledby="category-manager-title">
      <motion.div variants={backdropVariants} initial="hidden" animate="visible" className="fixed inset-0 bg-black/40" onClick={onClose} />
      <motion.div variants={modalPanelVariants} initial="hidden" animate="visible" className="relative bg-white dark:bg-slate-800 rounded-xl shadow-xl w-full max-w-lg max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-700">
          <h2 id="category-manager-title" className="text-lg font-semibold text-slate-900 dark:text-white">Manage Categories</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="p-2 rounded-md hover:bg-slate-100 dark:hover:bg-slate-700 focus:outline-hidden focus:ring-3 focus:ring-blue-500"
            style={{ minHeight: 44, minWidth: 44 }}
          >
            <XIcon size={18} className="text-slate-500" />
          </button>
        </div>

        {/* Category list */}
        <div className="flex-1 overflow-y-auto px-5 py-3">
          {categories.length === 0 && (
            <p className="text-slate-500 dark:text-slate-400 text-center py-6" style={{ fontSize: 15 }}>
              No categories yet. Add one below.
            </p>
          )}

          <div className="space-y-2">
            {categories.map(cat => (
              <div key={cat.id}>
                {editingId === cat.id ? (
                  /* Editing row */
                  <div className="rounded-lg border border-blue-300 dark:border-blue-600 p-3 space-y-3">
                    <div className="flex items-center gap-3">
                      <div
                        className="w-6 h-6 rounded-full flex-shrink-0 border border-slate-300 dark:border-slate-600"
                        style={{ backgroundColor: editColor }}
                      />
                      <input
                        value={editName}
                        onChange={e => setEditName(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') setEditingId(null) }}
                        className="flex-1 rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 px-3 py-1.5 text-slate-900 dark:text-white focus:outline-hidden focus:ring-3 focus:ring-blue-500"
                        style={{ fontSize: 15, minHeight: 40 }}
                        autoFocus
                      />
                      <button onClick={commitEdit} aria-label="Save name" className="hit-44 p-2 rounded-md bg-blue-600 text-white hover:bg-blue-700" style={{ minHeight: 40, minWidth: 40 }}>
                        <Check size={16} />
                      </button>
                      <button onClick={() => setEditingId(null)} aria-label="Cancel" className="hit-44 p-2 rounded-md text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700" style={{ minHeight: 40, minWidth: 40 }}>
                        <XIcon size={16} />
                      </button>
                    </div>
                    {/* Color swatches */}
                    <div className="flex flex-wrap gap-2">
                      {PRESET_COLORS.map(c => (
                        <button
                          key={c}
                          onClick={() => setEditColor(c)}
                          className={`hit-44 w-7 h-7 rounded-full border-2 transition-all ${editColor === c ? 'border-blue-500 scale-110' : 'border-transparent hover:border-slate-400'}`}
                          style={{ backgroundColor: c }}
                        />
                      ))}
                      <input
                        type="text"
                        value={editColor}
                        onChange={e => { setEditColor(e.target.value); setColorError(false) }}
                        onKeyDown={e => { if (e.key === 'Enter') commitEdit() }}
                        aria-label="Color code"
                        aria-invalid={colorError}
                        aria-describedby={colorError ? 'category-color-error' : undefined}
                        className={`w-24 rounded-sm border bg-white dark:bg-slate-700 px-2 py-1 text-base text-slate-700 dark:text-slate-300 focus:outline-hidden focus:ring-3 focus:ring-blue-500 ${colorError ? 'border-red-500' : 'border-slate-300 dark:border-slate-600'}`}
                        placeholder="#hex"
                      />
                    </div>
                    {colorError && (
                      <p id="category-color-error" role="alert" className="text-red-700 dark:text-red-300" style={{ fontSize: 15 }}>
                        Choose a color from the swatches, or type one like #3b82f6.
                      </p>
                    )}

                    {/* Custom Fields */}
                    <div className="border-t border-slate-200 dark:border-slate-600 pt-3">
                      <div className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-2">Custom Fields (max 10)</div>
                      {customFields.length === 0 && (
                        <p className="text-sm text-slate-500 dark:text-slate-400 mb-2 italic">
                          Examples: Medical → NPI, Specialty · Legal → Bar Number · Housing → Unit Type, Voucher #
                        </p>
                      )}
                      {customFields.length > 0 && (
                        <div className="space-y-1 mb-2">
                          {customFields.map(f => (
                            <div key={f.id} className="flex items-center gap-2 px-2 py-1 rounded-sm bg-slate-50 dark:bg-slate-700/50 group">
                              <span className="flex-1 text-sm text-slate-700 dark:text-slate-300" style={{ fontSize: 15 }}>{f.field_name}</span>
                              <span className="text-sm text-slate-500 dark:text-slate-400">{f.field_type}</span>
                              <button
                                onClick={() => deleteCustomField(f.id, editingId!)}
                                className="p-1 rounded-sm opacity-0 group-hover:opacity-100 hover:bg-red-100 dark:hover:bg-red-900/30 transition-opacity"
                                title="Remove field"
                                aria-label={`Remove field ${f.field_name}`}
                              >
                                <Trash2 size={12} className="text-red-400" />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                      {customFields.length < 10 && (
                        <div className="flex items-center gap-2">
                          <input
                            value={newFieldName}
                            onChange={e => setNewFieldName(e.target.value)}
                            onKeyDown={e => {
                              if (e.key === 'Enter' && newFieldName.trim()) {
                                createCustomField(editingId!, newFieldName.trim(), newFieldType)
                                setNewFieldName('')
                              }
                            }}
                            placeholder="Field name"
                            className="flex-1 rounded-sm border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 px-2 py-1 text-base text-slate-900 dark:text-white focus:outline-hidden focus:ring-3 focus:ring-blue-500"
                            style={{ fontSize: 15, minHeight: 32 }}
                          />
                          <select
                            value={newFieldType}
                            onChange={e => setNewFieldType(e.target.value)}
                            className="rounded-sm border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 px-2 py-1 text-base text-slate-700 dark:text-slate-300"
                            style={{ fontSize: 15, minHeight: 32 }}
                          >
                            <option value="text">Text</option>
                            <option value="phone">Phone</option>
                            <option value="email">Email</option>
                            <option value="url">URL</option>
                            <option value="number">Number</option>
                          </select>
                          <button
                            onClick={() => {
                              if (newFieldName.trim()) {
                                createCustomField(editingId!, newFieldName.trim(), newFieldType)
                                setNewFieldName('')
                              }
                            }}
                            disabled={!newFieldName.trim()}
                            aria-label="Add field"
                            className="hit-44 p-1.5 rounded-sm bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40"
                            style={{ minHeight: 32, minWidth: 32 }}
                          >
                            <Plus size={14} />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                ) : deletingId === cat.id ? (
                  /* Delete confirmation row */
                  <div className="rounded-lg border border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/20 p-3">
                    <p className="text-sm text-red-700 dark:text-red-300 mb-2" style={{ fontSize: 15 }}>
                      Delete &ldquo;{cat.name}&rdquo;? Contacts will become Uncategorized.
                    </p>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleDelete(cat.id)}
                        className="hit-44 px-3 py-1.5 rounded-md bg-red-600 text-white text-base hover:bg-red-700 focus:outline-hidden focus:ring-3 focus:ring-red-500"
                        style={{ minHeight: 36, fontSize: 15 }}
                      >
                        Delete
                      </button>
                      <button
                        onClick={() => setDeletingId(null)}
                        className="hit-44 px-3 py-1.5 rounded-md border border-slate-300 dark:border-slate-600 text-base text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
                        style={{ minHeight: 36, fontSize: 15 }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  /* Normal row */
                  <div className="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-700/50 group" style={{ minHeight: 44 }}>
                    <div
                      className="w-5 h-5 rounded-full flex-shrink-0"
                      style={{ backgroundColor: cat.color }}
                    />
                    <span className="flex-1 text-slate-900 dark:text-white" style={{ fontSize: 15 }}>{cat.name}</span>
                    <button
                      onClick={() => startEdit(cat.id, cat.name, cat.color)}
                      className="p-1.5 rounded-sm opacity-0 group-hover:opacity-100 hover:bg-slate-200 dark:hover:bg-slate-600 transition-opacity focus:outline-hidden focus:ring-3 focus:ring-blue-500 focus:opacity-100"
                      title="Edit"
                    >
                      <Pencil size={14} className="text-slate-500" />
                    </button>
                    <button
                      onClick={() => { setDeletingId(cat.id); setEditingId(null) }}
                      className="p-1.5 rounded-sm opacity-0 group-hover:opacity-100 hover:bg-red-100 dark:hover:bg-red-900/30 transition-opacity focus:outline-hidden focus:ring-3 focus:ring-red-500 focus:opacity-100"
                      title="Delete"
                    >
                      <Trash2 size={14} className="text-red-600 dark:text-red-400" />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Add new category */}
        <div className="border-t border-slate-200 dark:border-slate-700 px-5 py-4">
          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                const idx = PRESET_COLORS.indexOf(newColor)
                setNewColor(PRESET_COLORS[(idx + 1) % PRESET_COLORS.length] ?? PRESET_COLORS[0]!)
              }}
              className="hit-44 w-8 h-8 rounded-full flex-shrink-0 border-2 border-slate-300 dark:border-slate-600 hover:border-blue-500 transition-colors"
              style={{ backgroundColor: newColor }}
              title="Click to cycle colors"
            />
            <input
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleAdd() }}
              placeholder="New category name"
              className="flex-1 rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 px-3 py-2 text-slate-900 dark:text-white focus:outline-hidden focus:ring-3 focus:ring-blue-500"
              style={{ fontSize: 15, minHeight: 44 }}
            />
            <button
              onClick={handleAdd}
              disabled={!newName.trim()}
              className="flex items-center gap-1 px-3 rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-hidden focus:ring-3 focus:ring-blue-500"
              style={{ minHeight: 44, fontSize: 15 }}
            >
              <Plus size={16} />
              Add
            </button>
          </div>
        </div>
      </motion.div>
    </div>
    )}
    </>
  )
}
