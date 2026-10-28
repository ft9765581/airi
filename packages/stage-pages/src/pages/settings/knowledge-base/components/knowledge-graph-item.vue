<script setup lang="ts">
import type { KnowledgeGraphConnection } from '@proj-airi/stage-ui/stores/settings/knowledge-graph'

import { connectionScope } from '@proj-airi/stage-ui/stores/settings/connection-scope'
import { Checkbox, GhostButton } from '@proj-airi/ui'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import ConnectionStatusBadge from './connection-status-badge.vue'

import { useKnowledgeGraphConnectionTest } from '../composables/use-knowledge-graph-connection-test'

const props = defineProps<{
  connection: KnowledgeGraphConnection
}>()

const emit = defineEmits<{
  edit: [id: string]
  toggle: [id: string, enabled: boolean]
  remove: [id: string]
}>()

const { t } = useI18n()
const { testing, status, detail, run } = useKnowledgeGraphConnectionTest()

/** The flow name this row answers, so the list shows where it is used. */
const scopeLabel = computed(() =>
  connectionScope(props.connection) === 'medical'
    ? t('settings.pages.knowledge-base.graph.list.scope-medical')
    : t('settings.pages.knowledge-base.graph.list.scope-chat'),
)

function handleTest() {
  void run({
    baseUrl: props.connection.baseUrl,
    apiKey: props.connection.apiKey,
    bookId: props.connection.bookId,
  })
}
</script>

<template>
  <li
    :class="[
      'flex items-center justify-between gap-3',
      'rounded-lg bg-neutral-100 dark:bg-neutral-800/50',
      'p-3',
    ]"
  >
    <div :class="['flex min-w-0 flex-col gap-1']">
      <div :class="['flex items-center gap-2']">
        <span :class="['truncate text-sm font-medium']">{{ connection.name }}</span>
        <span
          :class="[
            'shrink-0 rounded-md px-1.5 py-0.5 text-xs',
            'bg-neutral-200/70 text-neutral-600',
            'dark:bg-neutral-700/60 dark:text-neutral-300',
          ]"
        >
          {{ scopeLabel }}
        </span>
        <ConnectionStatusBadge
          :status="status"
          phrase-prefix="settings.pages.knowledge-base.graph.result"
        />
      </div>
      <span :class="['truncate text-xs text-neutral-500 dark:text-neutral-400']">
        {{ connection.baseUrl }}<template v-if="connection.bookId"> · {{ connection.bookId }}</template>
      </span>
      <span v-if="detail" :class="['text-xs text-neutral-500 dark:text-neutral-400']">
        {{ detail }}
      </span>
    </div>

    <div :class="['flex shrink-0 items-center gap-2']">
      <label :class="['flex items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400']">
        {{ t('settings.pages.knowledge-base.graph.list.enabled') }}
        <Checkbox
          :model-value="connection.enabled"
          @update:model-value="value => emit('toggle', connection.id, value)"
        />
      </label>
      <GhostButton size="sm" @click="emit('edit', connection.id)">
        {{ t('settings.pages.knowledge-base.graph.list.edit') }}
      </GhostButton>
      <GhostButton size="sm" :disabled="testing" @click="handleTest">
        {{ testing ? t('settings.pages.knowledge-base.graph.result.testing') : t('settings.pages.knowledge-base.graph.list.test') }}
      </GhostButton>
      <GhostButton size="sm" @click="emit('remove', connection.id)">
        {{ t('settings.pages.knowledge-base.graph.list.remove') }}
      </GhostButton>
    </div>
  </li>
</template>
