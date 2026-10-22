<script setup lang="ts">
import { GhostButton } from '@proj-airi/ui'
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'

export interface LongTermMemoryListItem {
  id: string
  content: string
  whenLabel: string
  scopeLabel: string
}

defineProps<{
  items: readonly LongTermMemoryListItem[]
  deletingId: string | null
}>()

const emit = defineEmits<{
  edit: [id: string]
  delete: [id: string]
}>()

const confirmId = ref<string | null>(null)
const { t } = useI18n()

function requestDelete(id: string) {
  if (confirmId.value === id) {
    confirmId.value = null
    emit('delete', id)
    return
  }
  confirmId.value = id
}
</script>

<template>
  <ul :class="['flex flex-col']">
    <li
      v-for="item in items"
      :key="item.id"
      :class="[
        'flex items-start justify-between gap-3 rounded-xl px-3 py-2',
        'hover:bg-neutral-100 dark:hover:bg-neutral-800',
      ]"
    >
      <div :class="['min-w-0']">
        <p :class="['text-sm leading-6']">
          {{ item.content }}
        </p>
        <p :class="['text-xs text-neutral-500 dark:text-neutral-400']">
          {{ item.whenLabel }}
        </p>
        <p v-if="item.scopeLabel" :class="['text-xs text-neutral-400 dark:text-neutral-500']">
          {{ item.scopeLabel }}
        </p>
      </div>
      <div :class="['flex shrink-0 gap-1']">
        <GhostButton size="sm" @click="emit('edit', item.id)">
          {{ t('settings.pages.modules.memory-long-term.edit') }}
        </GhostButton>
        <GhostButton
          size="sm"
          :disabled="deletingId === item.id"
          @click="requestDelete(item.id)"
        >
          {{ confirmId === item.id ? t('settings.pages.modules.memory-long-term.confirm-delete') : t('settings.pages.modules.memory-long-term.delete') }}
        </GhostButton>
      </div>
    </li>
  </ul>
</template>
