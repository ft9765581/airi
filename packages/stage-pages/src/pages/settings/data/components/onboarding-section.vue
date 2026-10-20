<script setup lang="ts">
import { useOnboardingStore } from '@proj-airi/stage-ui/stores/onboarding'
import { Button } from '@proj-airi/ui'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const onboardingStore = useOnboardingStore()

function openOnboarding() {
  onboardingStore.forceShowSetup()
}
</script>

<template>
  <div :class="['border-2 border-neutral-200/50 rounded-xl bg-white/70 p-4 shadow-sm', 'dark:border-neutral-800/60 dark:bg-neutral-900/60']">
    <div :class="['grid grid-cols-1 items-start gap-3 md:grid-cols-[minmax(0,1fr)_auto]']">
      <div :class="['flex flex-col gap-1 md:max-w-[560px]']">
        <div :class="['text-lg font-medium']">
          {{ t('settings.pages.data.sections.onboarding.title') }}
        </div>
        <p :class="['text-sm text-neutral-600 dark:text-neutral-400']">
          {{ t('settings.pages.data.sections.onboarding.description') }}
        </p>
      </div>
      <div :class="['flex flex-col items-start gap-2']">
        <Button @click="openOnboarding">
          {{ t('settings.pages.data.sections.onboarding.open') }}
        </Button>
      </div>
    </div>
  </div>
</template>
