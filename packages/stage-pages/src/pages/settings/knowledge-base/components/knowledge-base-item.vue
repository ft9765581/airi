<script setup lang="ts">
import type { KnowledgeBaseConnection } from '@proj-airi/stage-ui/stores/settings/knowledge-base'

import { connectionScope } from '@proj-airi/stage-ui/stores/settings/knowledge-base'
import { Checkbox, GhostButton } from '@proj-airi/ui'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import KnowledgeBaseStatusBadge from './knowledge-base-status-badge.vue'

import { useKnowledgeBaseConnectionTest } from '../composables/use-connection-test'

const props = defineProps<{
  connection: KnowledgeBaseConnection
}>()

const emit = defineEmits<{
  edit: [id: string]
  toggle: [id: string, enabled: boolean]
  remove: [id: string]
}>()

const { t } = useI18n()
const { testing, status, detail, run } = useKnowledgeBaseConnectionTest()

/** The flow name this row answers, so the list shows where it is used. */
const scopeLabel = computed(() =>
  connectionScope(props.connection) === 'medical'
    ? t('settings.pages.knowledge-base.list.scope-medical')
    : t('settings.pages.knowledge-base.list.scope-chat'),
)

function handleTest() {
  void run({
    baseUrl: props.connection.baseUrl,
    apiKey: props.connection.apiKey,
    knowledgeBaseId: props.connection.knowledgeBaseId,
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
        <KnowledgeBaseStatusBadge :status="status" />
      </div>
      <span :class="['truncate text-xs text-neutral-500 dark:text-neutral-400']">
        {{ connection.baseUrl }}<template v-if="connection.knowledgeBaseId"> · {{ connection.knowledgeBaseId }}</template>
      </span>
      <span v-if="detail" :class="['text-xs text-neutral-500 dark:text-neutral-400']">
        {{ detail }}
      </span>
    </div>

    <div :class="['flex shrink-0 items-center gap-2']">
      <label :class="['flex items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400']">
        {{ t('settings.pages.knowledge-base.list.enabled') }}
        <Checkbox
          :model-value="connection.enabled"
          @update:model-value="value => emit('toggle', connection.id, value)"
        />
      </label>
      <GhostButton size="sm" @click="emit('edit', connection.id)">
        {{ t('settings.pages.knowledge-base.list.edit') }}
      </GhostButton>
      <GhostButton size="sm" :disabled="testing" @click="handleTest">
        {{ testing ? t('settings.pages.knowledge-base.result.testing') : t('settings.pages.knowledge-base.list.test') }}
      </GhostButton>
      <GhostButton size="sm" @click="emit('remove', connection.id)">
        {{ t('settings.pages.knowledge-base.list.remove') }}
      </GhostButton>
    </div>
  </li>
</template>
