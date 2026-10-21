import type { StoredMemory } from '../libs/memory-api'

import { errorMessageFrom } from '@moeru/std'
import { readonly, ref } from 'vue'

import { deleteMemory, listMemories } from '../libs/memory-api'

/**
 * Loads and deletes the signed-in account's long-term memory.
 *
 * The list is the server copy. A failed load or delete keeps the previous
 * list and stores the error for the settings page.
 */
export function useLongTermMemories() {
  const items = ref<StoredMemory[]>([])
  const loading = ref(false)
  const deletingId = ref<string | null>(null)
  const error = ref<string | null>(null)

  async function load(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      items.value = await listMemories()
    }
    catch (cause) {
      error.value = errorMessageFrom(cause) ?? 'Memory list failed'
    }
    finally {
      loading.value = false
    }
  }

  async function remove(memoryId: string): Promise<void> {
    deletingId.value = memoryId
    error.value = null
    try {
      await deleteMemory(memoryId)
      items.value = items.value.filter(item => item.id !== memoryId)
    }
    catch (cause) {
      error.value = errorMessageFrom(cause) ?? 'Memory delete failed'
    }
    finally {
      deletingId.value = null
    }
  }

  function clear(): void {
    items.value = []
    error.value = null
    deletingId.value = null
  }

  return {
    items: readonly(items),
    loading: readonly(loading),
    deletingId: readonly(deletingId),
    error: readonly(error),
    load,
    remove,
    clear,
  }
}
