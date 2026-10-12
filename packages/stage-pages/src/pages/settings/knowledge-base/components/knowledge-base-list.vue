<script setup lang="ts">
import type { KnowledgeBaseConnection } from '../types'

import { GhostButton } from '@proj-airi/ui'
import { useI18n } from 'vue-i18n'

defineProps<{
  connections: KnowledgeBaseConnection[]
}>()

const emit = defineEmits<{
  test: [id: string]
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
      <li
        v-for="connection in connections"
        :key="connection.id"
        :class="[
          'flex items-center justify-between gap-3',
          'rounded-lg bg-neutral-100 dark:bg-neutral-800/50',
          'p-3',
        ]"
      >
        <div :class="['flex min-w-0 flex-col gap-0.5']">
          <div :class="['flex items-center gap-2']">
            <span :class="['truncate text-sm font-medium']">{{ connection.name }}</span>
            <span
              :class="[
                'shrink-0 rounded-full px-2 py-0.5 text-xs',
                'bg-neutral-200 text-neutral-600 dark:bg-neutral-700 dark:text-neutral-300',
              ]"
            >
              {{ t('settings.pages.knowledge-base.status.disconnected') }}
            </span>
          </div>
          <span :class="['truncate text-xs text-neutral-500 dark:text-neutral-400']">
            {{ connection.baseUrl }}<template v-if="connection.knowledgeBaseId"> · {{ connection.knowledgeBaseId }}</template>
          </span>
        </div>
        <div :class="['flex shrink-0 items-center gap-1']">
          <GhostButton size="sm" @click="emit('test', connection.id)">
            {{ t('settings.pages.knowledge-base.list.test') }}
          </GhostButton>
          <GhostButton size="sm" @click="emit('remove', connection.id)">
            {{ t('settings.pages.knowledge-base.list.remove') }}
          </GhostButton>
        </div>
      </li>
    </ul>
  </div>
</template>
