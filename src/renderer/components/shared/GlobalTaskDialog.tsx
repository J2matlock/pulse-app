/**
 * GlobalTaskDialog — Quick-add task dialog that can be opened from anywhere
 * via Ctrl+Shift+T without navigating away from the current page. It's the
 * same dialog as the Tasks page's "Add task" (audit S-05).
 */
import React from 'react'
import toast from 'react-hot-toast'
import { useTaskStore } from '../../stores/taskStore'
import { TaskFormDialog, type NewTask } from '../../views/tasks/TaskFormDialog'

interface Props {
  open: boolean
  onClose: () => void
}

export function GlobalTaskDialog({ open, onClose }: Props): React.ReactElement | null {
  if (!open) return null
  return (
    <TaskFormDialog
      onClose={onClose}
      onSave={task => {
        void useTaskStore.getState().createTask(task as NewTask).then(created => {
          if (created) toast.success(`Task "${created.title}" created`)
        })
      }}
    />
  )
}
