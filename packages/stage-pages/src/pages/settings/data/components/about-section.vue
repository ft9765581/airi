<script setup lang="ts">
import { readBuildInfo } from '@proj-airi/stage-ui/libs/build-info'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

const appName = import.meta.env.VITE_APP_NAME || '清锡医疗'
const { configVersion, buildFile } = readBuildInfo()
</script>

<template>
  <div :class="['border-2 border-neutral-200/50 rounded-xl bg-white/70 p-4 shadow-sm', 'dark:border-neutral-800/60 dark:bg-neutral-900/60']">
    <div :class="['flex flex-col gap-2']">
      <div :class="['text-lg font-medium']">
        {{ t('settings.pages.data.sections.about.title') }}
      </div>
      <dl :class="['grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-sm']">
        <dt :class="['text-neutral-500 dark:text-neutral-400']">
          {{ t('settings.pages.data.sections.about.product') }}
        </dt>
        <dd :class="['break-all']">
          {{ appName }}
        </dd>

        <dt :class="['text-neutral-500 dark:text-neutral-400']">
          {{ t('settings.pages.data.sections.about.config-version') }}
        </dt>
        <dd :class="['break-all font-mono']">
          {{ configVersion || t('settings.pages.data.sections.about.development') }}
        </dd>

        <dt :class="['text-neutral-500 dark:text-neutral-400']">
          {{ t('settings.pages.data.sections.about.build') }}
        </dt>
        <dd :class="['break-all font-mono']">
          {{ buildFile || t('settings.pages.data.sections.about.development') }}
        </dd>
      </dl>
    </div>
  </div>
</template>
