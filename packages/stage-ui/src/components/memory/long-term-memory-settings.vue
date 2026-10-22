<script setup lang="ts">
import type { MemoryCategory } from '../../libs/memory-facts'

import { GhostButton } from '@proj-airi/ui'
import { storeToRefs } from 'pinia'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import LongTermMemoryForm from './long-term-memory-form.vue'
import LongTermMemoryList from './long-term-memory-list.vue'

import { useLongTermMemories } from '../../composables/use-long-term-memories'
import { useAuthStore } from '../../stores/auth'
import { useAiriCardStore } from '../../stores/modules/airi-card'
import { formatCoarseRelativeTime } from '../../utils/coarse-relative-time'

const { t, locale } = useI18n()
const auth = useAuthStore()
const cardStore = useAiriCardStore()
const { userId } = storeToRefs(auth)
const { items, loading, error, deletingId, saving, load, create, update, remove, clear } = useLongTermMemories()

const signedIn = computed(() => userId.value !== 'local')
const now = ref(Date.now())
const formOpen = ref(false)
const editingId = ref<string | null>(null)
const draftContent = ref('')
const draftCategory = ref<MemoryCategory>('other')

let clock: ReturnType<typeof setInterval> | undefined

onMounted(() => {
  clock = setInterval(() => {
    now.value = Date.now()
  }, 30_000)
})

onUnmounted(() => {
  if (clock)
    clearInterval(clock)
})

watch(signedIn, (value) => {
  if (value) {
    void load()
    return
  }
  clear()
  closeForm()
}, { immediate: true })

const editingItem = computed(() => items.value.find(item => item.id === editingId.value) ?? null)
const showCategory = computed(() => editingItem.value == null || editingItem.value.scope === 'user')

const rows = computed(() => items.value.map((item) => {
  const cardName = cardStore.cards.get(item.characterId)?.name || item.characterId
  const createdAt = new Date(item.createdAt).getTime()
  const whenLabel = Number.isNaN(createdAt)
    ? ''
    : formatCoarseRelativeTime(createdAt, now.value, locale.value)

  return {
    id: item.id,
    content: item.content,
    whenLabel,
    scopeLabel: item.scope === 'user'
      ? ''
      : t('settings.pages.modules.memory-long-term.scope-character', { name: cardName }),
  }
}))

const errorText = computed(() => {
  if (error.value === 'load')
    return t('settings.pages.modules.memory-long-term.load-error')
  if (error.value === 'save')
    return t('settings.pages.modules.memory-long-term.save-error')
  if (error.value === 'delete')
    return t('settings.pages.modules.memory-long-term.delete-error')
  return ''
})

function closeForm() {
  formOpen.value = false
  editingId.value = null
  draftContent.value = ''
  draftCategory.value = 'other'
}

function beginCreate() {
  editingId.value = null
  draftContent.value = ''
  draftCategory.value = 'other'
  formOpen.value = true
}

function beginEdit(id: string) {
  const item = items.value.find(entry => entry.id === id)
  if (!item)
    return
  editingId.value = id
  draftContent.value = item.content
  draftCategory.value = item.category ?? 'other'
  formOpen.value = true
}

async function saveDraft() {
  const content = draftContent.value.trim()
  if (content.length < 4)
    return

  let saved = false
  if (editingId.value) {
    saved = await update(editingId.value, {
      content,
      ...(showCategory.value ? { category: draftCategory.value } : {}),
    })
  }
  else {
    saved = await create({ content, category: draftCategory.value })
  }

  if (saved)
    closeForm()
}
</script>

<template>
  <div :class="['flex flex-col gap-4']">
    <div :class="['flex items-start justify-between gap-3']">
      <p :class="['text-sm text-neutral-600 dark:text-neutral-300']">
        {{ t('settings.pages.modules.memory-long-term.intro') }}
      </p>
      <GhostButton v-if="signedIn && !formOpen" size="sm" @click="beginCreate">
        {{ t('settings.pages.modules.memory-long-term.add') }}
      </GhostButton>
    </div>
    <p v-if="!signedIn" :class="['text-sm']">
      {{ t('settings.pages.modules.memory-long-term.sign-in') }}
    </p>
    <template v-else>
      <LongTermMemoryForm
        v-if="formOpen"
        v-model:content="draftContent"
        v-model:category="draftCategory"
        :show-category="showCategory"
        :saving="saving"
        @save="saveDraft"
        @cancel="closeForm"
      />
      <p v-if="loading" :class="['text-sm text-neutral-500']">
        {{ t('settings.pages.modules.memory-long-term.loading') }}
      </p>
      <p v-else-if="errorText && !rows.length" :class="['text-sm text-red-600 dark:text-red-400']">
        {{ errorText }}
      </p>
      <p v-else-if="!rows.length" :class="['text-sm text-neutral-500']">
        {{ t('settings.pages.modules.memory-long-term.empty') }}
      </p>
      <div v-else :class="['flex flex-col gap-3']">
        <p v-if="errorText" :class="['text-sm text-red-600 dark:text-red-400']">
          {{ errorText }}
        </p>
        <LongTermMemoryList
          :items="rows"
          :deleting-id="deletingId"
          @edit="beginEdit"
          @delete="remove"
        />
      </div>
    </template>
  </div>
</template>
