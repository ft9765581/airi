import type { StoredMemory } from '../libs/memory-api'
import type { MemoryCategory } from '../libs/memory-facts'

import { errorMessageFrom } from '@moeru/std'
import { readonly, ref } from 'vue'

import { createMemory, deleteMemory, listMemories, updateMemory } from '../libs/memory-api'

export type LongTermMemoryError = 'load' | 'save' | 'delete'

/**
 * Loads, creates, edits, and deletes the signed-in account's long-term memory.
 *
 * The list is the server copy. A failed load keeps the previous list and
 * stores the error for the settings page.
 */
export function useLongTermMemories() {
  const items = ref<StoredMemory[]>([])
  const loading = ref(false)
  const saving = ref(false)
  const deletingId = ref<string | null>(null)
  const error = ref<LongTermMemoryError | null>(null)

  async function load(): Promise<void> {
    const initial = items.value.length === 0
    if (initial)
      loading.value = true
    error.value = null
    try {
      items.value = await listMemories()
    }
    catch (cause) {
      error.value = 'load'
      if (import.meta.env.DEV)
        console.warn('[long-term-memory] list failed', errorMessageFrom(cause))
    }
    finally {
      loading.value = false
    }
  }

  async function create(input: { content: string, category: MemoryCategory }): Promise<boolean> {
    saving.value = true
    error.value = null
    try {
      await createMemory(input)
      await load()
      return true
    }
    catch (cause) {
      error.value = 'save'
      if (import.meta.env.DEV)
        console.warn('[long-term-memory] create failed', errorMessageFrom(cause))
      return false
    }
    finally {
      saving.value = false
    }
  }

  async function update(memoryId: string, input: { content: string, category?: MemoryCategory }): Promise<boolean> {
    saving.value = true
    error.value = null
    try {
      const saved = await updateMemory(memoryId, input)
      items.value = items.value.map(item => item.id === saved.id ? saved : item)
      return true
    }
    catch (cause) {
      error.value = 'save'
      if (import.meta.env.DEV)
        console.warn('[long-term-memory] update failed', errorMessageFrom(cause))
      return false
    }
    finally {
      saving.value = false
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
      error.value = 'delete'
      if (import.meta.env.DEV)
        console.warn('[long-term-memory] delete failed', errorMessageFrom(cause))
    }
    finally {
      deletingId.value = null
    }
  }

  function clear(): void {
    items.value = []
    error.value = null
    deletingId.value = null
    saving.value = false
  }

  return {
    items: readonly(items),
    loading: readonly(loading),
    saving: readonly(saving),
    deletingId: readonly(deletingId),
    error: readonly(error),
    load,
    create,
    update,
    remove,
    clear,
  }
}
