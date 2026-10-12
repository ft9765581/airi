<script setup lang="ts">
import type { KnowledgeBaseDraft } from '../types'

import { Button, FieldInput, GhostButton } from '@proj-airi/ui'
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'

const emit = defineEmits<{
  submit: [draft: KnowledgeBaseDraft]
  test: []
  cancel: []
}>()

const { t } = useI18n()

const name = ref('')
const baseUrl = ref('')
const apiKey = ref('')
const knowledgeBaseId = ref('')

function handleSubmit() {
  emit('submit', {
    name: name.value.trim(),
    baseUrl: baseUrl.value.trim(),
    apiKey: apiKey.value,
    knowledgeBaseId: knowledgeBaseId.value.trim(),
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
      {{ t('settings.pages.knowledge-base.form.title') }}
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
      type="password"
      :label="t('settings.pages.knowledge-base.form.api-key.label')"
      :description="t('settings.pages.knowledge-base.form.api-key.description')"
      :placeholder="t('settings.pages.knowledge-base.form.api-key.placeholder')"
    />
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
        {{ t('settings.pages.knowledge-base.form.save') }}
      </Button>
      <Button variant="secondary" @click="emit('test')">
        {{ t('settings.pages.knowledge-base.form.test') }}
      </Button>
      <GhostButton size="sm" @click="emit('cancel')">
        {{ t('settings.pages.knowledge-base.form.cancel') }}
      </GhostButton>
    </div>
  </div>
</template>
