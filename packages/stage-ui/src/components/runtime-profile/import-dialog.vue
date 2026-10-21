<script setup lang="ts">
import { Button, GhostButton } from '@proj-airi/ui'
import { useI18n } from 'vue-i18n'

defineProps<{
  open: boolean
  pending: boolean
  error: string | null
}>()

const emit = defineEmits<{
  import: []
  dismiss: []
}>()

const { t } = useI18n()
</script>

<template>
  <div
    v-if="open"
    :class="['fixed inset-0 z-50 flex items-center justify-center p-4']"
    role="dialog"
    aria-modal="true"
    aria-labelledby="runtime-profile-import-title"
  >
    <div :class="['absolute inset-0 bg-black/40']" />
    <div
      :class="[
        'relative flex max-w-md flex-col gap-4',
        'rounded-xl bg-white p-5 shadow-xl',
        'dark:bg-neutral-900',
      ]"
    >
      <h2 id="runtime-profile-import-title" :class="['text-lg font-medium']">
        {{ t('settings.dialogs.runtime-profile-import.title') }}
      </h2>
      <p :class="['text-sm text-neutral-600 dark:text-neutral-300']">
        {{ t('settings.dialogs.runtime-profile-import.description') }}
      </p>
      <p v-if="error" :class="['text-sm text-red-600 dark:text-red-400']">
        {{ error }}
      </p>
      <div :class="['flex justify-end gap-2']">
        <GhostButton :disabled="pending" @click="emit('dismiss')">
          {{ t('settings.dialogs.runtime-profile-import.dismiss') }}
        </GhostButton>
        <Button :disabled="pending" @click="emit('import')">
          {{ t('settings.dialogs.runtime-profile-import.import') }}
        </Button>
      </div>
    </div>
  </div>
</template>
