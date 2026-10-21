<script setup lang="ts">
import { LongTermMemoryList } from '@proj-airi/stage-ui/components'
import { useLongTermMemories } from '@proj-airi/stage-ui/composables/use-long-term-memories'
import { useAuthStore } from '@proj-airi/stage-ui/stores/auth'
import { useAiriCardStore } from '@proj-airi/stage-ui/stores/modules/airi-card'
import { storeToRefs } from 'pinia'
import { computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'

const { t, locale } = useI18n()
const auth = useAuthStore()
const cardStore = useAiriCardStore()
const { userId } = storeToRefs(auth)
const { items, loading, error, deletingId, load, remove, clear } = useLongTermMemories()

const signedIn = computed(() => userId.value !== 'local')

watch(signedIn, (value) => {
  if (value) {
    void load()
    return
  }
  clear()
}, { immediate: true })

const rows = computed(() => items.value.map((item) => {
  const cardName = cardStore.cards.get(item.characterId)?.name || item.characterId
  const when = new Date(item.createdAt)
  const whenLabel = Number.isNaN(when.getTime())
    ? ''
    : new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium', timeStyle: 'short' }).format(when)

  return {
    id: item.id,
    content: item.content,
    scopeLabel: item.scope === 'user'
      ? t('settings.pages.modules.memory-long-term.scope-user')
      : t('settings.pages.modules.memory-long-term.scope-character', { name: cardName }),
    recallLabel: t('settings.pages.modules.memory-long-term.recall', { count: item.recallCount }),
    whenLabel,
  }
}))
</script>

<template>
  <div :class="['flex flex-col gap-4']">
    <p :class="['text-sm text-neutral-600 dark:text-neutral-300']">
      {{ t('settings.pages.modules.memory-long-term.intro') }}
    </p>
    <p v-if="!signedIn" :class="['text-sm']">
      {{ t('settings.pages.modules.memory-long-term.sign-in') }}
    </p>
    <template v-else>
      <p v-if="loading" :class="['text-sm text-neutral-500']">
        {{ t('settings.pages.modules.memory-long-term.loading') }}
      </p>
      <p v-else-if="error && !rows.length" :class="['text-sm text-red-600 dark:text-red-400']">
        {{ t('settings.pages.modules.memory-long-term.load-error') }}
      </p>
      <p v-else-if="!rows.length" :class="['text-sm text-neutral-500']">
        {{ t('settings.pages.modules.memory-long-term.empty') }}
      </p>
      <div v-else :class="['flex flex-col gap-3']">
        <p v-if="error" :class="['text-sm text-red-600 dark:text-red-400']">
          {{ t('settings.pages.modules.memory-long-term.load-error') }}
        </p>
        <LongTermMemoryList
          :items="rows"
          :deleting-id="deletingId"
          @delete="remove"
        />
      </div>
    </template>
  </div>
</template>

<route lang="yaml">
meta:
  layout: settings
  titleKey: settings.pages.modules.memory-long-term.title
  subtitleKey: settings.title
  stageTransition:
    name: slide
</route>
