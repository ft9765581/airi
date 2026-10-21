<script setup lang="ts">
import { GhostButton } from '@proj-airi/ui'
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'

export interface LongTermMemoryListItem {
  id: string
  content: string
  scopeLabel: string
  recallLabel: string
  whenLabel: string
}

defineProps<{
  items: readonly LongTermMemoryListItem[]
  deletingId: string | null
}>()

const emit = defineEmits<{
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
  <ul :class="['flex flex-col gap-3']">
    <li
      v-for="item in items"
      :key="item.id"
      :class="[
        'flex flex-col gap-2 rounded-xl p-4',
        'bg-neutral-100 dark:bg-neutral-800',
      ]"
    >
      <p :class="['text-sm leading-6']">
        {{ item.content }}
      </p>
      <div :class="['flex flex-wrap items-center justify-between gap-2']">
        <p :class="['text-xs text-neutral-500 dark:text-neutral-400']">
          {{ item.scopeLabel }} · {{ item.recallLabel }} · {{ item.whenLabel }}
        </p>
        <GhostButton
          :disabled="deletingId === item.id"
          @click="requestDelete(item.id)"
        >
          {{ confirmId === item.id ? t('settings.pages.modules.memory-long-term.confirm-delete') : t('settings.pages.modules.memory-long-term.delete') }}
        </GhostButton>
      </div>
    </li>
  </ul>
</template>
