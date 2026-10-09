import { useState, useRef, useEffect, useCallback } from 'react'

interface GroupPickerProps {
  groups: Array<{ id: number; name: string }>
  onSelect: (groupId: number | null) => void
  onCreateAndSelect: (name: string) => void
  onCancel: () => void
}

export function GroupPicker({ groups, onSelect, onCreateAndSelect, onCancel }: GroupPickerProps) {
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (creating && inputRef.current) {
      inputRef.current.focus()
    }
  }, [creating])

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (creating) {
          setCreating(false)
          setNewName('')
        } else {
          onCancel()
        }
      }
    }

    function handleMouseDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onCancel()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    document.addEventListener('mousedown', handleMouseDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.removeEventListener('mousedown', handleMouseDown)
    }
  }, [creating, onCancel])

  const handleConfirmSelection = useCallback(() => {
    onSelect(selectedId)
  }, [onSelect, selectedId])

  const handleCreateSubmit = useCallback(() => {
    const trimmed = newName.trim().slice(0, 200)
    if (trimmed.length === 0) return
    onCreateAndSelect(trimmed)
  }, [newName, onCreateAndSelect])

  return (
    <div
      ref={containerRef}
      className="absolute z-50 w-72 bg-white dark:bg-slate-800 rounded-lg shadow-lg border border-slate-200 dark:border-slate-700 p-3"
    >
      <p className="text-sm font-medium text-slate-700 dark:text-slate-200 mb-2">
        Apply to group
      </p>

      <div className="max-h-[300px] overflow-y-auto">
        {/* Ungrouped option */}
        <label
          className="flex items-center gap-2 px-2 rounded cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-700"
          style={{ minHeight: '44px' }}
        >
          <input
            type="radio"
            name="group-picker"
            className="accent-blue-600 w-4 h-4"
            checked={selectedId === null}
            onChange={() => setSelectedId(null)}
          />
          <span className="text-[15px] text-slate-600 dark:text-slate-300">
            No group (ungrouped)
          </span>
        </label>

        {/* Existing groups */}
        {groups.map((group) => (
          <label
            key={group.id}
            className="flex items-center gap-2 px-2 rounded cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-700"
            style={{ minHeight: '44px' }}
          >
            <input
              type="radio"
              name="group-picker"
              className="accent-blue-600 w-4 h-4"
              checked={selectedId === group.id}
              onChange={() => setSelectedId(group.id)}
            />
            <span className="text-[15px] text-slate-700 dark:text-slate-200">
              {group.name}
            </span>
          </label>
        ))}

        {/* Divider */}
        <div className="border-t border-slate-200 dark:border-slate-700 my-1" />

        {/* Create new group */}
        {!creating ? (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="hit-44 flex items-center gap-2 px-2 w-full text-left rounded text-blue-600 dark:text-blue-400 hover:bg-slate-100 dark:hover:bg-slate-700 text-[15px] focus:ring-3 focus:ring-blue-500 focus:outline-none"
            style={{ minHeight: '44px' }}
          >
            + Create new group...
          </button>
        ) : (
          <div className="px-2 py-2">
            <input
              ref={inputRef}
              type="text"
              value={newName}
              maxLength={200}
              placeholder="Group name"
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  handleCreateSubmit()
                }
                if (e.key === 'Escape') {
                  e.stopPropagation()
                  setCreating(false)
                  setNewName('')
                }
              }}
              className="w-full px-2 py-2 text-[15px] border border-slate-300 dark:border-slate-600 rounded bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100 focus:ring-3 focus:ring-blue-500 focus:outline-none"
            />
          </div>
        )}
      </div>

      {/* Action buttons */}
      {!creating && (
        <div className="flex justify-end gap-2 mt-3 pt-2 border-t border-slate-200 dark:border-slate-700">
          <button
            type="button"
            onClick={onCancel}
            className="hit-44 px-3 py-1 text-base font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded focus:ring-3 focus:ring-blue-500 focus:outline-none"
            style={{ minHeight: '44px' }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirmSelection}
            className="hit-44 bg-blue-600 text-white hover:bg-blue-700 rounded px-3 py-1 text-base font-medium focus:ring-3 focus:ring-blue-500 focus:outline-none"
            style={{ minHeight: '44px' }}
          >
            Apply
          </button>
        </div>
      )}
    </div>
  )
}
