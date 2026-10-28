<script setup lang="ts">
import type { ConnectionTestStatus } from '../types'

import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{
  status: ConnectionTestStatus
  /** The i18n path that holds the four status labels, e.g. `settings.pages.knowledge-base.result`. */
  phrasePrefix: string
}>()

const { t } = useI18n()

const label = computed(() =>
  t(`${props.phrasePrefix}.${props.status}`),
)

const classes = computed(() => {
  switch (props.status) {
    case 'connected':
      return ['bg-green-100 text-green-700', 'dark:bg-green-900/40 dark:text-green-300']
    case 'failed':
      return ['bg-red-100 text-red-700', 'dark:bg-red-900/40 dark:text-red-300']
    case 'testing':
      return ['bg-amber-100 text-amber-700', 'dark:bg-amber-900/40 dark:text-amber-300']
    default:
      return ['bg-neutral-200 text-neutral-600', 'dark:bg-neutral-700 dark:text-neutral-300']
  }
})
</script>

<template>
  <span :class="['shrink-0 rounded-full px-2 py-0.5', 'text-xs', classes]">
    {{ label }}
  </span>
</template>
