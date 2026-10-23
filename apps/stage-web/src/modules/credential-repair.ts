/**
 * Repairs the credentials that the live stores hold after a build default.
 *
 * `applyBuildDefaults` writes `localStorage` before the stores start, so a store
 * can still hold the value that it read earlier: a blank DeepSeek record that
 * the character card created, or a model id that this build no longer names.
 * Chat reads the stores, so those two need the values of this build too.
 *
 * This module is separate from `defaults.ts` because it needs Pinia: the
 * defaults are pure storage writes, and a unit test of them must not start the
 * runtime stores.
 */

import { useConsciousnessStore } from '@proj-airi/stage-ui/stores/modules/consciousness'
import { useProviderConfigStore } from '@proj-airi/stage-ui/stores/providers/config'

import { storedApiKey } from './defaults'

function envValue(value: string | undefined): string {
  return value?.trim() ?? ''
}

/**
 * Puts this build's DeepSeek key into the live provider store.
 *
 * A blank DeepSeek record created by the character card can still be the value
 * the store loaded. Chat reads the store, so the key has to be there too.
 */
export function repairDeploymentCredentials(): void {
  const deepseekApiKey = envValue(import.meta.env.VITE_DEFAULT_DEEPSEEK_API_KEY)
  const deepseekModel = envValue(import.meta.env.VITE_DEFAULT_DEEPSEEK_MODEL)
  if (!deepseekApiKey)
    return

  const providerConfigStore = useProviderConfigStore()
  const currentKey = storedApiKey(providerConfigStore.getProvider('deepseek'))
  if (!currentKey) {
    providerConfigStore.updateProviderConfigFields('deepseek', 'deepseek', {
      apiKey: deepseekApiKey,
      thinkingMode: 'auto',
    })
    providerConfigStore.markProviderAdded('deepseek')
    providerConfigStore.setProviderStatus('deepseek', 'configured')
  }

  if (!deepseekModel)
    return

  const consciousness = useConsciousnessStore()
  const model = consciousness.activeModel
  const providerMissing = !consciousness.activeProvider
  const modelMissing = !model || model === 'deepseek-flash'
  if (!providerMissing && (consciousness.activeProvider !== 'deepseek' || !modelMissing))
    return

  if (providerMissing)
    consciousness.activeProvider = 'deepseek'
  if (consciousness.activeProvider === 'deepseek' && (!consciousness.activeModel || consciousness.activeModel === 'deepseek-flash'))
    consciousness.activeModel = deepseekModel
}
