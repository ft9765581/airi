<script setup lang="ts">
import type { KnowledgeBaseConnection, KnowledgeBaseDraft } from '@proj-airi/stage-ui/stores/settings/knowledge-base'

import { connectionScope } from '@proj-airi/stage-ui/stores/settings/knowledge-base'
import { Button, FieldCheckbox, FieldInput, GhostButton } from '@proj-airi/ui'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import KnowledgeBaseStatusBadge from './knowledge-base-status-badge.vue'

import { useKnowledgeBaseConnectionTest } from '../composables/use-connection-test'
import { defaultKnowledgeBaseApiKey, defaultKnowledgeBaseServerUrl } from '../defaults'

const props = defineProps<{
  /** The connection to edit. Without it, the form creates a connection. */
  connection?: KnowledgeBaseConnection
  /**
   * Values a new connection starts from.
   *
   * Ignored when `connection` is set: an edit must show the stored row, not a
   * preset that would silently replace it.
   */
  preset?: Partial<KnowledgeBaseConnection>
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
/**
 * Whether this connection answers the medical flow.
 *
 * One switch, two names: checked means the medical consultation branch reads
 * it, unchecked means ordinary chat does. The flows never share a connection,
 * so a patient cannot get a triage card in small talk.
 */
const medicalFlow = ref(false)

// The page keeps one form open at a time and replaces the `connection` prop
// when the user edits another row, so the fields follow the prop.
watch(() => [props.connection, props.preset] as const, () => {
  const source = props.connection ?? props.preset

  name.value = source?.name ?? ''
  baseUrl.value = source?.baseUrl ?? defaultKnowledgeBaseServerUrl
  apiKey.value = source?.apiKey ?? defaultKnowledgeBaseApiKey
  knowledgeBaseId.value = source?.knowledgeBaseId ?? ''
  revealApiKey.value = false
  medicalFlow.value = props.connection
    ? connectionScope(props.connection) === 'medical'
    : source?.scope === 'medical'
}, { immediate: true })

/** The retrieval test needs the address and the knowledge id. */
const readyForTest = computed(() => !!baseUrl.value.trim() && !!knowledgeBaseId.value.trim())

function handleSubmit() {
  emit('submit', {
    name: name.value.trim(),
    baseUrl: baseUrl.value.trim(),
    apiKey: apiKey.value.trim(),
    knowledgeBaseId: knowledgeBaseId.value.trim(),
    scope: medicalFlow.value ? 'medical' : 'chat',
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

    <FieldCheckbox
      v-model="medicalFlow"
      :label="t('settings.pages.knowledge-base.form.medical-flow.label')"
      :description="t('settings.pages.knowledge-base.form.medical-flow.description')"
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
