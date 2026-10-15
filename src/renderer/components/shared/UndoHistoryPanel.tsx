/**
 * UndoHistoryPanel — floating popover showing the full undo/redo stack.
 * Opened from the TopBar undo controls.
 */
import React, { useRef, useEffect, useState } from 'react'
import {
  RotateCcw, RotateCw, Trash2, Archive, PlusCircle, Plus, Pencil, Type,
  UserPlus, MessageSquare, CheckSquare, Check, Copy, Star, Tag, Link, Unlink,
  Pin, Timer, RefreshCcw, GripVertical, Paperclip,
  X, AlertTriangle, Clock
} from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useUndoStore } from '../../stores/undoStore'
import type { UndoItem } from '../../stores/undoStore'
import { ConfirmDialog } from './ConfirmDialog'
import { relativeTime } from '../../utils/relativeTime'
import { useVocab } from '../../hooks/useVocab'
import { modHelp } from '../../utils/keys'

interface Props {
  anchorRef: React.RefObject<HTMLElement>
  onClose: () => void
}

const ICON_MAP: Record<string, React.ReactElement> = {
  'trash':          <Trash2 className="w-3.5 h-3.5" />,
  'archive':        <Archive className="w-3.5 h-3.5" />,
  'plus-circle':    <PlusCircle className="w-3.5 h-3.5" />,
  'plus':           <Plus className="w-3.5 h-3.5" />,
  'pencil':         <Pencil className="w-3.5 h-3.5" />,
  'edit':           <Pencil className="w-3.5 h-3.5" />,
  'type':           <Type className="w-3.5 h-3.5" />,
  'user-plus':      <UserPlus className="w-3.5 h-3.5" />,
  'message-square': <MessageSquare className="w-3.5 h-3.5" />,
  'check-square':   <CheckSquare className="w-3.5 h-3.5" />,
  'check':          <Check className="w-3.5 h-3.5" />,
  'copy':           <Copy className="w-3.5 h-3.5" />,
  'star':           <Star className="w-3.5 h-3.5" />,
  'tag':            <Tag className="w-3.5 h-3.5" />,
  'link':           <Link className="w-3.5 h-3.5" />,
  'unlink':         <Unlink className="w-3.5 h-3.5" />,
  'pin':            <Pin className="w-3.5 h-3.5" />,
  'snooze':         <Timer className="w-3.5 h-3.5" />,
  'reorder':        <GripVertical className="w-3.5 h-3.5" />,
  'reset':          <RefreshCcw className="w-3.5 h-3.5" />,
  'paperclip':      <Paperclip className="w-3.5 h-3.5" />,
}

function getIcon(icon: string): React.ReactElement {
  return ICON_MAP[icon] ?? <Clock className="w-3.5 h-3.5" />
}


function hasVoidableItems(items: UndoItem[]): boolean {
  return items.some(i => i.sideEffects && i.sideEffects.length > 0)
}

/** Memoized item button for undo/redo stack entries — avoids re-rendering all items when one changes. */
const UndoItemButton = React.memo(function UndoItemButton({ item, onClick, title, variant }: {
  item: UndoItem
  onClick: () => void
  title: string
  variant: 'undo' | 'redo'
}): React.ReactElement {
  const { t } = useVocab(null)
  const isRedo = variant === 'redo'
  return (
    <button
      onClick={onClick}
      title={title}
      className={`hit-44 w-full flex items-center gap-2.5 px-3 py-2 text-left
                 hover:bg-slate-50 dark:hover:bg-slate-700/40 transition-colors group
                 focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-blue-500${isRedo ? ' opacity-60' : ''}`}
    >
      {/* Icon */}
      <div className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center ${
        isRedo
          ? 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400'
          : 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400'
      }`}>
        {getIcon(item.icon)}
      </div>
      {/* Text */}
      <div className="flex-1 min-w-0">
        <div className={`text-sm truncate leading-tight ${
          isRedo ? 'text-slate-500 dark:text-slate-400' : 'text-slate-700 dark:text-slate-300'
        }`}>
          {item.description}
        </div>
        {item.contextLabel && (
          <div className="text-sm text-slate-500 dark:text-slate-400 truncate">
            {item.contextLabel}
          </div>
        )}
      </div>
      {/* Badges */}
      <div className="flex items-center gap-1 flex-shrink-0">
        {!isRedo && item.sideEffects && item.sideEffects.length > 0 && (
          <span title={`Has a linked ${t('activity')} that will be voided`} className="text-amber-700 dark:text-amber-400">
            <AlertTriangle className="w-3 h-3" />
          </span>
        )}
        {isRedo && <RotateCw className="w-3 h-3 text-slate-500 dark:text-slate-400" />}
        <span className="text-sm text-slate-500 dark:text-slate-400 whitespace-nowrap">
          {relativeTime(item.timestamp)}
        </span>
      </div>
    </button>
  )
})

export function UndoHistoryPanel({ anchorRef, onClose }: Props): React.ReactElement {
  const { t } = useVocab(null)
  const { undoStack, redoStack, undo, redo, undoTo, clear } = useUndoStore(useShallow(s => ({
    undoStack: s.undoStack, redoStack: s.redoStack, undo: s.undo, redo: s.redo, undoTo: s.undoTo, clear: s.clear,
  })))
  const panelRef = useRef<HTMLDivElement>(null)
  const [confirmUndoTo, setConfirmUndoTo] = useState<string | null>(null)
  const [confirmClear, setConfirmClear] = useState(false)

  // Close on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (
        panelRef.current && !panelRef.current.contains(e.target as Node) &&
        anchorRef.current && !anchorRef.current.contains(e.target as Node)
      ) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [anchorRef, onClose])

  // Close on Escape
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  function handleUndoToClick(item: UndoItem) {
    // Find everything that would be undone
    const targetIdx = undoStack.findIndex(i => i.id === item.id)
    if (targetIdx === -1) return
    const itemsToUndo = undoStack.slice(targetIdx)
    if (itemsToUndo.length > 1 && hasVoidableItems(itemsToUndo)) {
      setConfirmUndoTo(item.id)
    } else {
      void undoTo(item.id).then(onClose)
    }
  }

  const canUndo = undoStack.length > 0
  const canRedo = redoStack.length > 0

  // Items to show in undo section: most recent first (reverse of stack order)
  const undoItems = [...undoStack].reverse()
  // Items to show in redo section: most recent redo first (last of redoStack = most recent)
  const redoItems = [...redoStack].reverse()

  return (
    <>
      <div
        ref={panelRef}
        className="absolute right-0 top-full mt-1 z-[200] w-80
                   bg-white dark:bg-slate-800
                   border border-slate-200 dark:border-slate-700
                   rounded-xl shadow-2xl overflow-hidden"
        role="dialog"
        aria-label="Action history"
      >
        {/* Header */}
        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-slate-200 dark:border-slate-700">
          <span className="text-sm font-semibold text-slate-700 dark:text-slate-300 flex-1">
            Action history
          </span>
          <button
            onClick={() => setConfirmClear(true)}
            disabled={undoStack.length === 0 && redoStack.length === 0}
            className="hit-44 text-base text-slate-500 hover:text-red-500 dark:hover:text-red-400
                       disabled:opacity-40 disabled:cursor-not-allowed
                       focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500 rounded-sm px-1"
          >
            Forget history…
          </button>
          <button
            onClick={onClose}
            aria-label="Close"
            className="hit-44 p-1 rounded-sm hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500
                       focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Quick undo/redo row */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-100 dark:border-slate-700/50">
          <button
            onClick={() => { void undo() }}
            disabled={!canUndo}
            title={modHelp('Undo (Ctrl+Z)')}
            className="hit-44 flex items-center gap-1.5 flex-1 justify-center py-1.5 rounded-md text-base
                       bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300
                       hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors
                       disabled:opacity-40 disabled:cursor-not-allowed
                       focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Undo
          </button>
          <button
            onClick={() => { void redo() }}
            disabled={!canRedo}
            title={modHelp('Redo (Ctrl+Y)')}
            className="hit-44 flex items-center gap-1.5 flex-1 justify-center py-1.5 rounded-md text-base
                       bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300
                       hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors
                       disabled:opacity-40 disabled:cursor-not-allowed
                       focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500"
          >
            <RotateCw className="w-3.5 h-3.5" />
            Redo
          </button>
        </div>

        {/* Stack list: shorter in a short window, so the panel never runs off the bottom at 200% zoom (AUDIT-055) */}
        <div className="overflow-y-auto" style={{ maxHeight: 'min(360px, calc(100vh - 12rem))' }}>
          {undoStack.length === 0 && redoStack.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400 text-center py-8">
              No actions to undo
            </p>
          ) : (
            <>
              {/* Undoable items */}
              {undoItems.map((item, i) => (
                <UndoItemButton
                  key={item.id}
                  item={item}
                  onClick={() => handleUndoToClick(item)}
                  title={i === 0 ? 'Undo this action' : `Undo to here (${i + 1} actions)`}
                  variant="undo"
                />
              ))}

              {/* Divider */}
              {undoItems.length > 0 && redoItems.length > 0 && (
                <div className="flex items-center gap-2 px-3 py-1">
                  <div className="flex-1 h-px bg-slate-200 dark:bg-slate-700" />
                  <span className="text-sm text-slate-500 dark:text-slate-400 whitespace-nowrap">current position</span>
                  <div className="flex-1 h-px bg-slate-200 dark:bg-slate-700" />
                </div>
              )}

              {/* Redoable items */}
              {redoItems.map(item => (
                <UndoItemButton
                  key={item.id}
                  item={item}
                  onClick={() => { void redo(); onClose() }}
                  title="Redo this action"
                  variant="redo"
                />
              ))}
            </>
          )}
        </div>

        {/* Footer hint */}
        {(item => item && item.sideEffects && item.sideEffects.length > 0)(undoItems[0]) && (
          <div className="px-3 py-2 border-t border-slate-100 dark:border-slate-700/50 bg-amber-50 dark:bg-amber-900/10">
            <p className="text-sm text-amber-700 dark:text-amber-400 flex items-start gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
              Next undo has a log entry — it will be marked as voided (kept, and shown with "Show voided").
            </p>
          </div>
        )}
      </div>

      {/* Jump-to-point confirmation */}
      {confirmUndoTo && (
        <ConfirmDialog
          open
          title="Undo these actions?"
          message={`Some of the actions being undone have linked ${t('activity', { many: true })}. Those will be marked as voided: kept, and shown when you tick "Show voided ${t('activity', { many: true })}".`}
          confirmLabel="Undo all"
          destructive={false}
          onConfirm={() => {
            const id = confirmUndoTo
            setConfirmUndoTo(null)
            void undoTo(id).then(onClose)
          }}
          onCancel={() => setConfirmUndoTo(null)}
        />
      )}

      {/* Clear all confirmation */}
      {confirmClear && (
        <ConfirmDialog
          open
          title="Forget the undo history?"
          message="You won't be able to undo or redo anything you've done so far. Your data stays as it is."
          confirmLabel="Forget history"
          onConfirm={() => { setConfirmClear(false); clear(); onClose() }}
          onCancel={() => setConfirmClear(false)}
        />
      )}
    </>
  )
}
