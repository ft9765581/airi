import { useLocalStorageManualReset } from '@proj-airi/stage-shared/composables'
import { defineStore } from 'pinia'

/**
 * Free-text profile of the person AIRI talks to.
 *
 * The chat runtime reads this store on every request and injects the content as
 * side context, so an edit reaches the next turn without a reload.
 *
 * The content is author-owned: only the settings page writes it. The runtime
 * never derives or appends to it, because AIRI has no automatic memory
 * extraction yet.
 */
export const useSettingsUserProfile = defineStore('settings-user-profile', () => {
  const content = useLocalStorageManualReset<string>('settings/user-profile/content', '')

  function resetState() {
    content.reset()
  }

  return {
    content,
    resetState,
  }
})
