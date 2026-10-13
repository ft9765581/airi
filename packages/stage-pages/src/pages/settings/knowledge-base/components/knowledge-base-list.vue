<script setup lang="ts">
import type { KnowledgeBaseConnection } from '@proj-airi/stage-ui/stores/settings/knowledge-base'

import { useI18n } from 'vue-i18n'

import KnowledgeBaseItem from './knowledge-base-item.vue'

defineProps<{
  connections: KnowledgeBaseConnection[]
}>()

const emit = defineEmits<{
  edit: [id: string]
  toggle: [id: string, enabled: boolean]
  remove: [id: string]
}>()

const { t } = useI18n()
</script>

<template>
  <div
    :class="[
      'flex flex-col gap-3',
      'rounded-xl border-2 border-solid border-neutral-100 dark:border-neutral-800',
      'bg-neutral-50 dark:bg-neutral-900',
      'p-4',
    ]"
  >
    <span :class="['text-sm font-medium']">
      {{ t('settings.pages.knowledge-base.list.title') }}
    </span>

    <div
      v-if="!connections.length"
      :class="[
        'flex flex-col gap-1',
        'rounded-lg bg-neutral-100 dark:bg-neutral-800/50',
        'p-4',
      ]"
    >
      <span :class="['text-xs text-neutral-600 dark:text-neutral-300']">
        {{ t('settings.pages.knowledge-base.list.empty') }}
      </span>
      <span :class="['text-xs text-neutral-500 dark:text-neutral-400']">
        {{ t('settings.pages.knowledge-base.list.empty-hint') }}
      </span>
    </div>

    <ul v-else :class="['flex flex-col gap-2']">
      <KnowledgeBaseItem
        v-for="connection in connections"
        :key="connection.id"
        :connection="connection"
        @edit="id => emit('edit', id)"
        @toggle="(id, enabled) => emit('toggle', id, enabled)"
        @remove="id => emit('remove', id)"
      />
    </ul>
  </div>
</template>
