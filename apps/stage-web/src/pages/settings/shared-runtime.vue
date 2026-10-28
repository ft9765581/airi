<script setup lang="ts">
import { errorMessageFrom } from '@moeru/std'
import { Button } from '@proj-airi/ui'
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { useSharedRuntimeStore } from '../../modules/shared-runtime'

const sharedRuntime = useSharedRuntimeStore()
const { t } = useI18n()
const saving = ref(false)
const message = ref('')

async function publish() {
  saving.value = true
  message.value = ''
  try {
    await sharedRuntime.publish()
    message.value = t('settings.pages.shared-runtime.published')
  }
  catch (error) {
    message.value = errorMessageFrom(error) ?? t('settings.pages.shared-runtime.failed')
  }
  finally {
    saving.value = false
  }
}
</script>

<template>
  <div :class="['flex flex-col gap-4 p-4']">
    <p>{{ t('settings.pages.shared-runtime.summary') }}</p>
    <p v-if="sharedRuntime.updatedAt">
      {{ t('settings.pages.shared-runtime.updated-at', { date: sharedRuntime.updatedAt }) }}
    </p>
    <p v-if="!sharedRuntime.canEdit">
      {{ t('settings.pages.shared-runtime.admin-only') }}
    </p>
    <template v-else>
      <p>
        {{ t('settings.pages.shared-runtime.instructions') }}
      </p>
      <Button :disabled="saving" :label="t('settings.pages.shared-runtime.publish')" @click="publish" />
    </template>
    <p v-if="message" role="status">
      {{ message }}
    </p>
  </div>
</template>

<route lang="yaml">
meta:
  layout: settings
  titleKey: settings.pages.shared-runtime.title
  subtitleKey: settings.title
  descriptionKey: settings.pages.shared-runtime.description
  icon: i-solar:settings-bold-duotone
  settingsEntry: true
  order: 9.5
</route>
