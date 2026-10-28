<script setup lang="ts">
import type { SelectTabOption } from '@proj-airi/ui'

import { SelectTab } from '@proj-airi/ui'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import KnowledgeBaseConnections from './components/knowledge-base-connections.vue'
import KnowledgeGraphConnections from './components/knowledge-graph-connections.vue'

/**
 * The two connection kinds this page hosts.
 *
 * They share the page because a user connects them the same way: an address, a
 * key, the id of the resource, and one flow to answer. Two separate settings
 * entries made the second one hard to find.
 */
type ConnectionSection = 'knowledge-base' | 'knowledge-graph'

const { t } = useI18n()

const section = ref<ConnectionSection>('knowledge-base')

const sections = computed<SelectTabOption<ConnectionSection>[]>(() => [
  {
    label: t('settings.pages.knowledge-base.tabs.knowledge-base'),
    value: 'knowledge-base',
    icon: 'i-solar:notebook-bold-duotone',
  },
  {
    label: t('settings.pages.knowledge-base.tabs.knowledge-graph'),
    value: 'knowledge-graph',
    icon: 'i-solar:graph-bold-duotone',
  },
])
</script>

<template>
  <div :class="['flex flex-col gap-4 pb-4']">
    <SelectTab
      v-model="section"
      :options="sections"
      size="sm"
    />

    <KnowledgeBaseConnections v-if="section === 'knowledge-base'" />
    <KnowledgeGraphConnections v-else />
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
