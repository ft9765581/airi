<script setup lang="ts">
import type { MemoryCategory } from '../../libs/memory-facts'

import { FieldInput, FieldSelect, GhostButton } from '@proj-airi/ui'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { MEMORY_CATEGORIES } from '../../libs/memory-facts'

defineProps<{
  showCategory: boolean
  saving: boolean
}>()

const emit = defineEmits<{
  save: []
  cancel: []
}>()
const content = defineModel<string>('content', { required: true })
const category = defineModel<MemoryCategory>('category', { required: true })

const { t } = useI18n()

const categoryOptions = computed(() => MEMORY_CATEGORIES.map(value => ({
  value,
  label: t(`settings.pages.modules.memory-long-term.categories.${value}`),
})))
</script>

<template>
  <form
    :class="['flex flex-col gap-3 rounded-xl p-4', 'bg-neutral-100 dark:bg-neutral-800']"
    @submit.prevent="emit('save')"
  >
    <FieldInput
      v-model="content"
      :label="t('settings.pages.modules.memory-long-term.content-label')"
      :placeholder="t('settings.pages.modules.memory-long-term.content-placeholder')"
      :single-line="false"
    />
    <FieldSelect
      v-if="showCategory"
      v-model="category"
      :label="t('settings.pages.modules.memory-long-term.category-label')"
      :options="categoryOptions"
      layout="vertical"
    />
    <div :class="['flex justify-end gap-2']">
      <GhostButton type="button" size="sm" @click="emit('cancel')">
        {{ t('settings.pages.modules.memory-long-term.cancel') }}
      </GhostButton>
      <GhostButton type="submit" size="sm" :disabled="saving || content.trim().length < 4">
        {{ t('settings.pages.modules.memory-long-term.save') }}
      </GhostButton>
    </div>
  </form>
</template>
