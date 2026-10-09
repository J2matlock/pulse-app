/**
 * Set the workspace words (and feature switches) for a test. Tests written
 * before the vocabulary layer expect an existing install: human-services
 * words and every feature that shipped turned on.
 */
import { useWorkspaceStore } from '../../src/renderer/stores/workspaceStore'
import { HUMAN_SERVICES_VOCAB, type Vocab } from '../../src/shared/vocab'
import { featuresForExistingInstall, type FeatureMap } from '../../src/shared/features'

export const EXISTING_FEATURES: FeatureMap = featuresForExistingInstall({ trackTime: false, trackMileage: false })

export function setWords(
  vocab: Partial<Vocab> = HUMAN_SERVICES_VOCAB,
  gridVocab: Record<number, Partial<Vocab>> = {},
  features: FeatureMap = EXISTING_FEATURES,
): void {
  useWorkspaceStore.setState({ vocab, gridVocab, features })
}

export function setFeatures(features: FeatureMap = EXISTING_FEATURES): void {
  useWorkspaceStore.setState({ features })
}
