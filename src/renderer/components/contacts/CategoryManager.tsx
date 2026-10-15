import { useState, useEffect } from 'react'
import { X as XIcon, Trash2, Check, Plus } from 'lucide-react'
import { Dialog } from '../ui/Dialog'
import { useShallow } from 'zustand/react/shallow'
import { useContactsStore } from '../../stores/contactsStore'
import { normalizeHexColor } from '../../../shared/color'
import { PrimaryButton, SecondaryButton, DangerButton, IconButton } from '../ui/Button'


const PRESET_COLORS = [
  '#3b82f6', '#8b5cf6', '#f59e0b', '#22c55e',
  '#ef4444', '#14b8a6', '#f97316', '#6366f1',
  '#f43f5e', '#64748b', '#ec4899', '#84cc16',
]
/** What each swatch is called, for people who can't see it */
const COLOR_NAMES: Record<string, string> = {
  '#3b82f6': 'Blue', '#8b5cf6': 'Purple', '#f59e0b': 'Amber', '#22c55e': 'Green',
  '#ef4444': 'Red', '#14b8a6': 'Teal', '#f97316': 'Orange', '#6366f1': 'Indigo',
  '#f43f5e': 'Rose', '#64748b': 'Gray', '#ec4899': 'Pink', '#84cc16': 'Lime',
}

export function CategoryManager({ open, onClose }: { open: boolean; onClose: () => void }) {
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
    <Dialog open onClose={onClose} size="lg" title="Manage categories"
      footer={<>
        {/* Add new category, pinned under the list */}
        <div className="flex w-full items-center gap-3">
          <button
            onClick={() => {
              const idx = PRESET_COLORS.indexOf(newColor)
              setNewColor(PRESET_COLORS[(idx + 1) % PRESET_COLORS.length] ?? PRESET_COLORS[0]!)
            }}
            className="hit-44 w-8 h-8 rounded-full flex-shrink-0 border-2 border-slate-300 dark:border-slate-600 hover:border-blue-500 transition-colors"
            style={{ backgroundColor: newColor }}
            title="Click to cycle colors"
            aria-label={`Color: ${COLOR_NAMES[newColor] ?? newColor}. Click for the next color`}
          />
          <input
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleAdd() }}
            placeholder="New category name"
            className="flex-1 rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 px-3 py-2 text-slate-900 dark:text-white focus:outline-hidden focus:ring-3 focus:ring-blue-500"
            style={{ fontSize: 15, minHeight: 44 }}
          />
          <PrimaryButton onClick={handleAdd} disabled={!newName.trim()} icon={<Plus size={16} />}>
            Add
          </PrimaryButton>
        </div>
      </>}>
      {/* Category list */}
      <div>
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
                      onKeyDown={e => {
                        if (e.key === 'Enter') commitEdit()
                        // Escape here leaves the rename, not the dialog
                        if (e.key === 'Escape') { e.stopPropagation(); setEditingId(null) }
                      }}
                      className="flex-1 rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 px-3 py-1.5 text-slate-900 dark:text-white focus:outline-hidden focus:ring-3 focus:ring-blue-500"
                      style={{ fontSize: 15, minHeight: 44 }}
                      autoFocus
                    />
                    <IconButton label="Save name" variant="primary" icon={<Check size={16} />} onClick={commitEdit} />
                    <IconButton label="Cancel" icon={<XIcon size={16} />} onClick={() => setEditingId(null)} />
                  </div>
                  {/* Color swatches */}
                  <div className="flex flex-wrap gap-2">
                    {PRESET_COLORS.map(c => (
                      <button
                        key={c}
                        onClick={() => setEditColor(c)}
                        aria-label={COLOR_NAMES[c] ?? c}
                        aria-pressed={editColor === c}
                        title={COLOR_NAMES[c] ?? c}
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

                  {/* Extra details (custom fields) */}
                  <div className="border-t border-slate-200 dark:border-slate-600 pt-3">
                    <div className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-2">Extra details (up to 10)</div>
                    {customFields.length === 0 && (
                      <p className="text-sm text-slate-500 dark:text-slate-400 mb-2 italic">
                        Examples: Medical → NPI, Specialty · Legal → Bar number · Housing → Unit type, Voucher #
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
                              className="hit-44 p-1 rounded-sm hover:bg-red-100 dark:hover:bg-red-900/30 focus:outline-hidden focus-visible:ring-3 focus-visible:ring-red-500"
                              title={`Remove the detail "${f.field_name}"`}
                              aria-label={`Remove the detail "${f.field_name}"`}
                            >
                              <Trash2 size={16} className="text-red-600 dark:text-red-400" />
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
                          placeholder="Detail name"
                          aria-label="Name of the new detail"
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
                        <PrimaryButton
                          size="compact"
                          icon={<Plus size={14} />}
                          onClick={() => {
                            if (newFieldName.trim()) {
                              createCustomField(editingId!, newFieldName.trim(), newFieldType)
                              setNewFieldName('')
                            }
                          }}
                          disabled={!newFieldName.trim()}
                        >
                          Add detail
                        </PrimaryButton>
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
                    <DangerButton size="compact" onClick={() => handleDelete(cat.id)}>
                      Delete
                    </DangerButton>
                    <SecondaryButton size="compact" onClick={() => setDeletingId(null)}>
                      Cancel
                    </SecondaryButton>
                  </div>
                </div>
              ) : (
                /* Normal row: Edit and Delete always visible, and the field count says custom fields exist (E-12) */
                <div className="flex flex-wrap items-center gap-3 rounded-lg px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-700/50" style={{ minHeight: 44 }}>
                  <div
                    className="w-5 h-5 rounded-full flex-shrink-0"
                    style={{ backgroundColor: cat.color }}
                  />
                  <span className="flex-1 min-w-0">
                    <span className="block text-slate-900 dark:text-white" style={{ fontSize: 15 }}>{cat.name}</span>
                    <span className="block text-sm text-slate-500 dark:text-slate-400">Fields: {cat.field_count ?? 0}</span>
                  </span>
                  <SecondaryButton size="compact" onClick={() => startEdit(cat.id, cat.name, cat.color)} aria-label={`Edit ${cat.name}`}>
                    Edit
                  </SecondaryButton>
                  <button
                    type="button"
                    onClick={() => { setDeletingId(cat.id); setEditingId(null) }}
                    aria-label={`Delete ${cat.name}`}
                    className="px-3 rounded-md border border-red-300 dark:border-red-700 text-red-700 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/30 focus:outline-hidden focus-visible:ring-3 focus-visible:ring-red-500"
                    style={{ minHeight: 44, fontSize: 15 }}
                  >
                    Delete
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </Dialog>
    )}
    </>
  )
}
