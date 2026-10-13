<script setup lang="ts">
import type { KnowledgeBaseConnection, KnowledgeBaseDraft } from '@proj-airi/stage-ui/stores/settings/knowledge-base'

import { Button, FieldInput, GhostButton } from '@proj-airi/ui'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import KnowledgeBaseStatusBadge from './knowledge-base-status-badge.vue'

import { useKnowledgeBaseConnectionTest } from '../composables/use-connection-test'
import { defaultKnowledgeBaseApiKey, defaultKnowledgeBaseServerUrl } from '../defaults'

const props = defineProps<{
  /** The connection to edit. Without it, the form creates a connection. */
  connection?: KnowledgeBaseConnection
}>()

const emit = defineEmits<{
  submit: [draft: KnowledgeBaseDraft]
  cancel: []
}>()

const { t } = useI18n()
const { testing, status, detail, run } = useKnowledgeBaseConnectionTest()

const isEditing = computed(() => props.connection !== undefined)

const name = ref('')
const baseUrl = ref('')
const apiKey = ref('')
const knowledgeBaseId = ref('')
const revealApiKey = ref(false)

// The page keeps one form open at a time and replaces the `connection` prop
// when the user edits another row, so the fields follow the prop.
watch(() => props.connection, (connection) => {
  name.value = connection?.name ?? ''
  baseUrl.value = connection?.baseUrl ?? defaultKnowledgeBaseServerUrl
  apiKey.value = connection?.apiKey ?? defaultKnowledgeBaseApiKey
  knowledgeBaseId.value = connection?.knowledgeBaseId ?? ''
  revealApiKey.value = false
}, { immediate: true })

/** The retrieval test needs the address and the knowledge id. */
const readyForTest = computed(() => !!baseUrl.value.trim() && !!knowledgeBaseId.value.trim())

function handleSubmit() {
  emit('submit', {
    name: name.value.trim(),
    baseUrl: baseUrl.value.trim(),
    apiKey: apiKey.value.trim(),
    knowledgeBaseId: knowledgeBaseId.value.trim(),
  })
}

function handleTest() {
  void run({
    baseUrl: baseUrl.value,
    apiKey: apiKey.value,
    knowledgeBaseId: knowledgeBaseId.value,
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
        ? t('settings.pages.knowledge-base.form.title-edit')
        : t('settings.pages.knowledge-base.form.title') }}
    </span>

    <FieldInput
      v-model="name"
      :label="t('settings.pages.knowledge-base.form.name.label')"
      :description="t('settings.pages.knowledge-base.form.name.description')"
      :placeholder="t('settings.pages.knowledge-base.form.name.placeholder')"
    />
    <FieldInput
      v-model="baseUrl"
      :label="t('settings.pages.knowledge-base.form.base-url.label')"
      :description="t('settings.pages.knowledge-base.form.base-url.description')"
      :placeholder="t('settings.pages.knowledge-base.form.base-url.placeholder')"
      required
    />
    <FieldInput
      v-model="apiKey"
      :type="revealApiKey ? 'text' : 'password'"
      :label="t('settings.pages.knowledge-base.form.api-key.label')"
      :description="t('settings.pages.knowledge-base.form.api-key.description')"
      :placeholder="t('settings.pages.knowledge-base.form.api-key.placeholder')"
    />
    <div :class="['flex items-center gap-2']">
      <GhostButton
        size="sm"
        :icon="revealApiKey ? 'i-solar:eye-closed-bold-duotone' : 'i-solar:eye-bold-duotone'"
        @click="revealApiKey = !revealApiKey"
      >
        {{ revealApiKey
          ? t('settings.pages.knowledge-base.form.hide-api-key')
          : t('settings.pages.knowledge-base.form.show-api-key') }}
      </GhostButton>
    </div>
    <FieldInput
      v-model="knowledgeBaseId"
      :label="t('settings.pages.knowledge-base.form.knowledge-base-id.label')"
      :description="t('settings.pages.knowledge-base.form.knowledge-base-id.description')"
      :placeholder="t('settings.pages.knowledge-base.form.knowledge-base-id.placeholder')"
    />

    <div :class="['flex items-center gap-2']">
      <Button
        color="primary"
        variant="primary"
        :disabled="!baseUrl.trim()"
        @click="handleSubmit"
      >
        {{ isEditing
          ? t('settings.pages.knowledge-base.form.save-edit')
          : t('settings.pages.knowledge-base.form.save') }}
      </Button>
      <Button variant="secondary" :disabled="!readyForTest || testing" @click="handleTest">
        {{ testing ? t('settings.pages.knowledge-base.result.testing') : t('settings.pages.knowledge-base.form.test') }}
      </Button>
      <GhostButton size="sm" @click="emit('cancel')">
        {{ t('settings.pages.knowledge-base.form.cancel') }}
      </GhostButton>
    </div>

    <span
      v-if="!readyForTest"
      :class="['text-xs text-neutral-500 dark:text-neutral-400']"
    >
      {{ t('settings.pages.knowledge-base.form.needs-knowledge-id') }}
    </span>

    <div v-if="detail" :class="['flex items-center gap-2']">
      <KnowledgeBaseStatusBadge :status="status" />
      <span :class="['text-xs text-neutral-500 dark:text-neutral-400']">{{ detail }}</span>
    </div>
  </div>
</template>
