<script setup lang="ts">
import type { KnowledgeBaseConnection, KnowledgeBaseDraft } from '@proj-airi/stage-ui/stores/settings/knowledge-base'

import { useSettingsKnowledgeBase } from '@proj-airi/stage-ui/stores/settings/knowledge-base'
import { Button, GhostButton } from '@proj-airi/ui'
import { nanoid } from 'nanoid'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import KnowledgeBaseForm from './components/knowledge-base-form.vue'
import KnowledgeBaseList from './components/knowledge-base-list.vue'

import { defaultKnowledgeBaseKnowledgeId, defaultKnowledgeBaseServerUrl } from './defaults'

const { t } = useI18n()
const knowledgeBaseStore = useSettingsKnowledgeBase()

const connections = computed(() => knowledgeBaseStore.connections)
const connectedCount = computed(() => connections.value.length)

// `editingId` holds the row under edit. An open form without it creates a
// connection. One form is open at a time.
const formOpen = ref(false)
const editingId = ref<string>()
/**
 * Values a new medical connection starts from.
 *
 * The medical branch reads only connections marked for it (§21 of the fork
 * log). Sending every new connection there would put triage records into small
 * talk, so the choice stays explicit — but the address and the switch are
 * filled in, because retyping a deployment URL invites typos.
 */
const preset = ref<KnowledgeBaseConnection>()

const editingConnection = computed(() =>
  editingId.value
    ? connections.value.find(connection => connection.id === editingId.value)
    : undefined,
)

function openCreate() {
  editingId.value = undefined
  preset.value = undefined
  formOpen.value = true
}

function openMedicalPreset() {
  editingId.value = undefined
  preset.value = {
    id: '',
    name: t('settings.pages.knowledge-base.list.add-medical-name'),
    baseUrl: defaultKnowledgeBaseServerUrl,
    apiKey: '',
    knowledgeBaseId: defaultKnowledgeBaseKnowledgeId,
    enabled: true,
    scope: 'medical',
  }
  formOpen.value = true
}

function openEdit(id: string) {
  editingId.value = id
  preset.value = undefined
  formOpen.value = true
}

function closeForm() {
  formOpen.value = false
  editingId.value = undefined
  preset.value = undefined
}

/** The connection fields a save writes, without the identity and the switch. */
function toConnectionFields(draft: KnowledgeBaseDraft) {
  return {
    name: draft.name || draft.baseUrl,
    baseUrl: draft.baseUrl,
    apiKey: draft.apiKey,
    knowledgeBaseId: draft.knowledgeBaseId,
    scope: draft.scope,
  }
}

function handleSubmit(draft: KnowledgeBaseDraft) {
  if (editingId.value) {
    const editedId = editingId.value
    knowledgeBaseStore.connections = knowledgeBaseStore.connections.map(connection =>
      connection.id === editedId
        ? { ...connection, ...toConnectionFields(draft) }
        : connection,
    )
  }
  else {
    knowledgeBaseStore.connections = [
      ...knowledgeBaseStore.connections,
      { id: nanoid(), enabled: true, ...toConnectionFields(draft) },
    ]
  }

  closeForm()
}

function handleToggle(id: string, enabled: boolean) {
  knowledgeBaseStore.connections = knowledgeBaseStore.connections.map(connection =>
    connection.id === id ? { ...connection, enabled } : connection,
  )
}

function handleRemove(id: string) {
  knowledgeBaseStore.connections = knowledgeBaseStore.connections.filter(
    connection => connection.id !== id,
  )

  if (editingId.value === id)
    closeForm()
}
</script>

<template>
  <div :class="['flex flex-col gap-4 pb-4']">
    <div
      :class="[
        'flex items-center justify-between gap-3',
        'rounded-xl border-2 border-solid border-neutral-100 dark:border-neutral-800',
        'bg-neutral-50 dark:bg-neutral-900',
        'p-4',
      ]"
    >
      <div :class="['flex items-center gap-3']">
        <div :class="['i-solar:notebook-bold-duotone', 'size-8 shrink-0 text-neutral-400 dark:text-neutral-500']" />
        <div :class="['flex flex-col gap-1']">
          <span :class="['text-sm font-medium']">
            {{ t('settings.pages.knowledge-base.status.title') }}
          </span>
          <span :class="['text-xs text-neutral-500 dark:text-neutral-400']">
            {{ t('settings.pages.knowledge-base.status.connected-count', { count: connectedCount }) }}
          </span>
        </div>
      </div>
      <div v-if="!formOpen" :class="['flex flex-wrap items-center gap-2']">
        <GhostButton
          size="sm"
          icon="i-solar:stethoscope-bold-duotone"
          @click="openMedicalPreset"
        >
          {{ t('settings.pages.knowledge-base.list.add-medical') }}
        </GhostButton>
        <Button
          color="primary"
          variant="primary"
          icon="i-solar:add-circle-bold-duotone"
          :label="t('settings.pages.knowledge-base.list.add')"
          @click="openCreate"
        />
      </div>
    </div>

    <span :class="['text-xs text-neutral-500 dark:text-neutral-400']">
      {{ t('settings.pages.knowledge-base.notice.storage') }}
    </span>

    <KnowledgeBaseList
      :connections="connections"
      @edit="openEdit"
      @toggle="handleToggle"
      @remove="handleRemove"
    />

    <KnowledgeBaseForm
      v-if="formOpen"
      :connection="editingConnection"
      :preset="preset"
      @submit="handleSubmit"
      @cancel="closeForm"
    />
  </div>
</template>

<route lang="yaml">
meta:
  layout: settings
  titleKey: settings.pages.knowledge-base.title
  subtitleKey: settings.title
  descriptionKey: settings.pages.knowledge-base.description
  icon: i-solar:notebook-bold-duotone
  settingsEntry: true
  order: 6.5
  stageTransition:
    name: slide
</route>
