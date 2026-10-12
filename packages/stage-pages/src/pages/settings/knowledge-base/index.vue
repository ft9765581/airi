<script setup lang="ts">
import type { KnowledgeBaseConnection, KnowledgeBaseDraft } from './types'

import { Button } from '@proj-airi/ui'
import { nanoid } from 'nanoid'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import KnowledgeBaseForm from './components/knowledge-base-form.vue'
import KnowledgeBaseList from './components/knowledge-base-list.vue'

const { t } = useI18n()

// NOTICE:
// The connection list is demo state for the interface only. It stays in this
// page, clears on refresh, and sends no request. Move it into a settings store
// when the knowledge base client lands.
const connections = ref<KnowledgeBaseConnection[]>([])
const adding = ref(false)
const notice = ref('')

const connectedCount = computed(() => connections.value.length)

function handleAdd(draft: KnowledgeBaseDraft) {
  connections.value = [
    ...connections.value,
    {
      id: nanoid(),
      name: draft.name || draft.baseUrl,
      baseUrl: draft.baseUrl,
      knowledgeBaseId: draft.knowledgeBaseId,
    },
  ]
  adding.value = false
  notice.value = ''
}

function handleRemove(id: string) {
  connections.value = connections.value.filter(connection => connection.id !== id)
}

function handleTest() {
  notice.value = t('settings.pages.knowledge-base.notice.not-available')
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
      <Button
        v-if="!adding"
        color="primary"
        variant="primary"
        icon="i-solar:add-circle-bold-duotone"
        :label="t('settings.pages.knowledge-base.list.add')"
        @click="adding = true"
      />
    </div>

    <span :class="['text-xs text-neutral-500 dark:text-neutral-400']">
      {{ t('settings.pages.knowledge-base.notice.demo') }}
    </span>

    <KnowledgeBaseList
      :connections="connections"
      @test="handleTest"
      @remove="handleRemove"
    />

    <KnowledgeBaseForm
      v-if="adding"
      @submit="handleAdd"
      @test="handleTest"
      @cancel="adding = false"
    />

    <span v-if="notice" :class="['text-xs text-neutral-500 dark:text-neutral-400']">
      {{ notice }}
    </span>
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
