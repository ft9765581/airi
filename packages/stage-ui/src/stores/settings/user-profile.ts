import { useLocalStorageManualReset } from '@proj-airi/stage-shared/composables'
import { defineStore } from 'pinia'

/**
 * Free-text profile of the person AIRI talks to.
 *
 * The chat runtime reads this store on every request and injects the content as
 * side context, so an edit reaches the next turn without a reload.
 *
 * The settings page writes it. Once a day, memory rollup also writes it:
 * a fact from an earlier local day replaces an overlapping line, or is
 * appended under its category heading.
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
