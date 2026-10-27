<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { useStageEmotionStore } from '../../stores/stage-emotion'

const { t } = useI18n()
const { current } = storeToRefs(useStageEmotionStore())

const label = computed(() => current.value
  ? t(`stage.emotion-badge.emotions.${current.value.name}`)
  : '')

const strength = computed(() => Math.round((current.value?.intensity ?? 0) * 100))
</script>

<template>
  <div
    v-if="current"
    :class="[
      'pointer-events-none flex items-center gap-2',
      'rounded-full border border-solid px-3 py-1',
      'border-neutral-200 dark:border-neutral-700',
      'bg-white/80 dark:bg-black/60',
      'backdrop-blur-lg',
      'text-sm text-neutral-700 dark:text-neutral-200',
      'shadow-sm',
    ]"
    data-testid="stage-emotion-badge"
    role="status"
    :aria-label="t('stage.emotion-badge.aria')"
  >
    <span>{{ label }}</span>
    <span :class="['text-xs text-neutral-400 dark:text-neutral-500']">{{ strength }}%</span>
  </div>
</template>
