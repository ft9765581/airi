<script setup lang="ts">
import { useSettingsUserProfile } from '@proj-airi/stage-ui/stores/settings/user-profile'
import { FieldInput, GhostButton } from '@proj-airi/ui'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const profileStore = useSettingsUserProfile()

const content = computed({
  get: () => profileStore.content,
  set: (value: string) => {
    profileStore.content = value
  },
})

const characterCount = computed(() => content.value.trim().length)

function clearProfile() {
  content.value = ''
}
</script>

<template>
  <div :class="['flex flex-col gap-4 pb-4']">
    <FieldInput
      v-model="content"
      :label="t('settings.pages.user-profile.content.label')"
      :description="t('settings.pages.user-profile.content.description')"
      :placeholder="t('settings.pages.user-profile.content.placeholder')"
      :single-line="false"
      input-class="min-h-56"
    />
    <div :class="['flex items-center justify-between gap-3']">
      <span :class="['text-xs text-neutral-500 dark:text-neutral-400']">
        {{ t('settings.pages.user-profile.saved') }}
        <template v-if="characterCount">· {{ characterCount }}</template>
      </span>
      <GhostButton size="sm" :disabled="!characterCount" @click="clearProfile">
        {{ t('settings.pages.user-profile.clear') }}
      </GhostButton>
    </div>
  </div>
</template>

<route lang="yaml">
meta:
  layout: settings
  titleKey: settings.pages.user-profile.title
  subtitleKey: settings.title
  descriptionKey: settings.pages.user-profile.description
  icon: i-solar:user-id-bold-duotone
  settingsEntry: true
  order: 5.5
  stageTransition:
    name: slide
</route>
