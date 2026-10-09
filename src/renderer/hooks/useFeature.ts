import { useWorkspaceStore } from '../stores/workspaceStore'
import { isOn, type FeatureKey } from '../../shared/features'

/** Whether an optional feature is switched on for this workspace. */
export function useFeature(key: FeatureKey): boolean {
  return useWorkspaceStore(s => isOn(s.features, key))
}

/** Same check outside React (keyboard handlers, stores); read at call time. */
export function featureNow(key: FeatureKey): boolean {
  return isOn(useWorkspaceStore.getState().features, key)
}
