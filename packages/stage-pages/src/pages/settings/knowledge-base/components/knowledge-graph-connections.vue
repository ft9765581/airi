<script setup lang="ts">
import type { KnowledgeGraphDraft } from '@proj-airi/stage-ui/stores/settings/knowledge-graph'

import { useSettingsKnowledgeGraph } from '@proj-airi/stage-ui/stores/settings/knowledge-graph'
import { Button } from '@proj-airi/ui'
import { nanoid } from 'nanoid'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import KnowledgeGraphForm from './knowledge-graph-form.vue'
import KnowledgeGraphList from './knowledge-graph-list.vue'

const { t } = useI18n()
const knowledgeGraphStore = useSettingsKnowledgeGraph()

const connections = computed(() => knowledgeGraphStore.connections)
const connectedCount = computed(() => connections.value.filter(connection => connection.enabled).length)

// `editingId` holds the row under edit. An open form without it creates a
// connection. One form is open at a time.
const formOpen = ref(false)
const editingId = ref<string>()
const editingConnection = computed(() =>
  editingId.value
    ? connections.value.find(connection => connection.id === editingId.value)
    : undefined,
)

function openCreate() {
  editingId.value = undefined
  formOpen.value = true
}

function openEdit(id: string) {
  editingId.value = id
  formOpen.value = true
}

function closeForm() {
  formOpen.value = false
  editingId.value = undefined
}

/** The connection fields a save writes, without the identity and the switch. */
function toConnectionFields(draft: KnowledgeGraphDraft) {
  return {
    name: draft.name || draft.baseUrl,
    baseUrl: draft.baseUrl,
    apiKey: draft.apiKey,
    bookId: draft.bookId || undefined,
    scope: draft.scope,
  }
}

function handleSubmit(draft: KnowledgeGraphDraft) {
  if (editingId.value) {
    const editedId = editingId.value
    knowledgeGraphStore.connections = knowledgeGraphStore.connections.map(connection =>
      connection.id === editedId
        ? { ...connection, ...toConnectionFields(draft) }
        : connection,
    )
  }
  else {
    knowledgeGraphStore.connections = [
      ...knowledgeGraphStore.connections,
      { id: nanoid(), enabled: true, ...toConnectionFields(draft) },
    ]
  }

  closeForm()
}

function handleToggle(id: string, enabled: boolean) {
  knowledgeGraphStore.connections = knowledgeGraphStore.connections.map(connection =>
    connection.id === id ? { ...connection, enabled } : connection,
  )
}

function handleRemove(id: string) {
  knowledgeGraphStore.connections = knowledgeGraphStore.connections.filter(
    connection => connection.id !== id,
  )

  if (editingId.value === id)
    closeForm()
}
</script>

<template>
  <div :class="['flex flex-col gap-4']">
    <div
      :class="[
        'flex items-center justify-between gap-3',
        'rounded-xl border-2 border-solid border-neutral-100 dark:border-neutral-800',
        'bg-neutral-50 dark:bg-neutral-900',
        'p-4',
      ]"
    >
      <div :class="['flex items-center gap-3']">
        <div :class="['i-solar:graph-bold-duotone', 'size-8 shrink-0 text-neutral-400 dark:text-neutral-500']" />
        <div :class="['flex flex-col gap-1']">
          <span :class="['text-sm font-medium']">
            {{ t('settings.pages.knowledge-base.graph.status.title') }}
          </span>
          <span :class="['text-xs text-neutral-500 dark:text-neutral-400']">
            {{ t('settings.pages.knowledge-base.graph.status.connected-count', { count: connectedCount }) }}
          </span>
        </div>
      </div>
      <div v-if="!formOpen" :class="['flex flex-wrap items-center gap-2']">
        <Button
          color="primary"
          variant="primary"
          icon="i-solar:add-circle-bold-duotone"
          :label="t('settings.pages.knowledge-base.graph.list.add')"
          @click="openCreate"
        />
      </div>
    </div>

    <span :class="['text-xs text-neutral-500 dark:text-neutral-400']">
      {{ t('settings.pages.knowledge-base.graph.notice.storage') }}
    </span>

    <span :class="['text-xs text-neutral-500 dark:text-neutral-400']">
      {{ t('settings.pages.knowledge-base.graph.notice.scope') }}
    </span>

    <KnowledgeGraphList
      :connections="connections"
      @edit="openEdit"
      @toggle="handleToggle"
      @remove="handleRemove"
    />

    <KnowledgeGraphForm
      v-if="formOpen"
      :connection="editingConnection"
      @submit="handleSubmit"
      @cancel="closeForm"
    />
  </div>
</template>
