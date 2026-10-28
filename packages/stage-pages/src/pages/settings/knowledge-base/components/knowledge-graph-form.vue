<script setup lang="ts">
import type { KnowledgeGraphConnection, KnowledgeGraphDraft } from '@proj-airi/stage-ui/stores/settings/knowledge-graph'

import { connectionScope } from '@proj-airi/stage-ui/stores/settings/connection-scope'
import { Button, FieldCheckbox, FieldInput, GhostButton } from '@proj-airi/ui'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import ConnectionStatusBadge from './connection-status-badge.vue'

import { useKnowledgeGraphConnectionTest } from '../composables/use-knowledge-graph-connection-test'
import {
  defaultKnowledgeGraphApiKey,
  defaultKnowledgeGraphBookId,
  defaultKnowledgeGraphServerUrl,
} from '../defaults'

const props = defineProps<{
  /** The connection to edit. Without it, the form creates a connection. */
  connection?: KnowledgeGraphConnection
}>()

const emit = defineEmits<{
  submit: [draft: KnowledgeGraphDraft]
  cancel: []
}>()

const { t } = useI18n()
const { testing, status, detail, run } = useKnowledgeGraphConnectionTest()

const isEditing = computed(() => props.connection !== undefined)

const name = ref('')
const baseUrl = ref('')
const apiKey = ref('')
const bookId = ref('')
const revealApiKey = ref(false)
/**
 * Whether this connection answers the medical flow.
 *
 * One switch, two names: checked means the medical consultation branch reads it,
 * unchecked means ordinary chat does. No chat turn reads the graph list yet, so
 * the value only records the intent until that wiring lands.
 */
const medicalFlow = ref(false)

// The page keeps one form open at a time and replaces the `connection` prop when
// the user edits another row, so the fields follow the prop.
watch(() => props.connection, () => {
  const source = props.connection

  name.value = source?.name ?? ''
  baseUrl.value = source?.baseUrl ?? defaultKnowledgeGraphServerUrl
  apiKey.value = source?.apiKey ?? defaultKnowledgeGraphApiKey
  bookId.value = source?.bookId ?? defaultKnowledgeGraphBookId
  revealApiKey.value = false
  medicalFlow.value = source ? connectionScope(source) === 'medical' : false
}, { immediate: true })

/** The search test needs only the address; the document id is optional. */
const readyForTest = computed(() => !!baseUrl.value.trim())

function handleSubmit() {
  emit('submit', {
    name: name.value.trim(),
    baseUrl: baseUrl.value.trim(),
    apiKey: apiKey.value.trim(),
    bookId: bookId.value.trim(),
    scope: medicalFlow.value ? 'medical' : 'chat',
  })
}

function handleTest() {
  void run({
    baseUrl: baseUrl.value,
    apiKey: apiKey.value,
    bookId: bookId.value,
  })
}
</script>

<template>
  <div
    :class="[
      'flex flex-col gap-4',
      'rounded-xl border-2 border-solid border-neutral-100 dark:border-neutral-800',
      'bg-neutral-50 dark:bg-neutral-900',
      'p-4',
    ]"
  >
    <span :class="['text-sm font-medium']">
      {{ isEditing
        ? t('settings.pages.knowledge-base.graph.form.title-edit')
        : t('settings.pages.knowledge-base.graph.form.title') }}
    </span>

    <FieldInput
      v-model="name"
      :label="t('settings.pages.knowledge-base.graph.form.name.label')"
      :description="t('settings.pages.knowledge-base.graph.form.name.description')"
      :placeholder="t('settings.pages.knowledge-base.graph.form.name.placeholder')"
    />
    <FieldInput
      v-model="baseUrl"
      :label="t('settings.pages.knowledge-base.graph.form.base-url.label')"
      :description="t('settings.pages.knowledge-base.graph.form.base-url.description')"
      :placeholder="t('settings.pages.knowledge-base.graph.form.base-url.placeholder')"
      required
    />
    <FieldInput
      v-model="apiKey"
      :type="revealApiKey ? 'text' : 'password'"
      :label="t('settings.pages.knowledge-base.graph.form.api-key.label')"
      :description="t('settings.pages.knowledge-base.graph.form.api-key.description')"
      :placeholder="t('settings.pages.knowledge-base.graph.form.api-key.placeholder')"
    />
    <div :class="['flex items-center gap-2']">
      <GhostButton
        size="sm"
        :icon="revealApiKey ? 'i-solar:eye-closed-bold-duotone' : 'i-solar:eye-bold-duotone'"
        @click="revealApiKey = !revealApiKey"
      >
        {{ revealApiKey
          ? t('settings.pages.knowledge-base.graph.form.hide-api-key')
          : t('settings.pages.knowledge-base.graph.form.show-api-key') }}
      </GhostButton>
    </div>
    <FieldInput
      v-model="bookId"
      :label="t('settings.pages.knowledge-base.graph.form.book-id.label')"
      :description="t('settings.pages.knowledge-base.graph.form.book-id.description')"
      :placeholder="t('settings.pages.knowledge-base.graph.form.book-id.placeholder')"
    />

    <FieldCheckbox
      v-model="medicalFlow"
      :label="t('settings.pages.knowledge-base.graph.form.medical-flow.label')"
      :description="t('settings.pages.knowledge-base.graph.form.medical-flow.description')"
    />

    <div :class="['flex items-center gap-2']">
      <Button
        color="primary"
        variant="primary"
        :disabled="!baseUrl.trim()"
        @click="handleSubmit"
      >
        {{ isEditing
          ? t('settings.pages.knowledge-base.graph.form.save-edit')
          : t('settings.pages.knowledge-base.graph.form.save') }}
      </Button>
      <Button variant="secondary" :disabled="!readyForTest || testing" @click="handleTest">
        {{ testing ? t('settings.pages.knowledge-base.graph.result.testing') : t('settings.pages.knowledge-base.graph.form.test') }}
      </Button>
      <GhostButton size="sm" @click="emit('cancel')">
        {{ t('settings.pages.knowledge-base.graph.form.cancel') }}
      </GhostButton>
    </div>

    <span
      v-if="!readyForTest"
      :class="['text-xs text-neutral-500 dark:text-neutral-400']"
    >
      {{ t('settings.pages.knowledge-base.graph.form.needs-server-url') }}
    </span>

    <div v-if="detail" :class="['flex items-center gap-2']">
      <ConnectionStatusBadge
        :status="status"
        phrase-prefix="settings.pages.knowledge-base.graph.result"
      />
      <span :class="['text-xs text-neutral-500 dark:text-neutral-400']">{{ detail }}</span>
    </div>
  </div>
</template>
