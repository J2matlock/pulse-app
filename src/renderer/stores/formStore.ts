import { create } from 'zustand'
import { IPC } from '../../shared/ipc-channels'
import type { Form } from '../../shared/forms'
import { storeInvoke } from '../utils/safeInvoke'
import { rlog } from '../utils/rendererLogger'

/** Each list's forms (W08), for the "Use form" and "Fill form" menus */
interface FormStore {
  byGrid: Record<number, Form[]>
  load: (gridId: number) => Promise<void>
}

export const useFormStore = create<FormStore>((set) => ({
  byGrid: {},
  load: async (gridId) => {
    try {
      const forms = await storeInvoke<Form[]>(IPC.FORM_LIST, gridId)
      set(s => ({ byGrid: { ...s.byGrid, [gridId]: Array.isArray(forms) ? forms : [] } }))
    } catch (err) {
      rlog.warn('FormStore', 'Could not load forms', err)
    }
  },
}))
