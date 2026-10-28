import type { AiriCard } from '@proj-airi/stage-ui/stores/modules/airi-card'
import type { KnowledgeBaseConnection } from '@proj-airi/stage-ui/stores/settings/knowledge-base'

import { authedFetch } from '@proj-airi/stage-ui/libs/auth-fetch'
import { SERVER_URL } from '@proj-airi/stage-ui/libs/server'
import { useAiriCardStore } from '@proj-airi/stage-ui/stores/modules/airi-card'
import { useArtistryStore } from '@proj-airi/stage-ui/stores/modules/artistry'
import { useConsciousnessStore } from '@proj-airi/stage-ui/stores/modules/consciousness'
import { useHearingStore } from '@proj-airi/stage-ui/stores/modules/hearing'
import { useSpeechStore } from '@proj-airi/stage-ui/stores/modules/speech'
import { useVisionStore } from '@proj-airi/stage-ui/stores/modules/vision'
import { useSettingsKnowledgeBase } from '@proj-airi/stage-ui/stores/settings/knowledge-base'
import { defineStore } from 'pinia'
import { ref, watch } from 'vue'

interface SharedSettings {
  cards: Array<{ id: string, card: AiriCard }>
  activeCardId: string
  models: {
    chatProvider: string
    chatModel: string
    speechProvider: string
    speechModel: string
    speechVoice: string
    hearingProvider: string
    hearingModel: string
    visionProvider: string
    visionModel: string
    artistryProvider: string
    artistryModel: string
  }
  knowledgeBase: Array<Omit<KnowledgeBaseConnection, 'apiKey'>>
}

interface Snapshot {
  settings: SharedSettings | null
  updatedAt: string | null
  canEdit: boolean
}

const endpoint = new URL('/api/v1/shared-runtime', SERVER_URL)

/**
 * Talks to the shared runtime endpoint.
 *
 * NOTICE:
 * A plain `pnpm dev` does not start the API that `SERVER_URL` names, and the
 * settings page would then sit in "administrator only" forever. The dev server
 * answers this path itself (plugin in `vite.config.ts`), and this function uses
 * that answer only when the real endpoint is not reachable. A production build
 * folds `import.meta.env.DEV` to false and keeps only the authenticated call.
 * Removal condition: when the local backend is part of the standard dev flow.
 */
async function requestSharedRuntime(init?: RequestInit) {
  if (!import.meta.env.DEV)
    return authedFetch(endpoint, init)

  try {
    return await authedFetch(endpoint, init)
  }
  catch {
    // Nothing listens on the API port: the dev server takes the request instead.
    return fetch(new URL('/api/v1/shared-runtime', location.origin), init)
  }
}

/** Applies the deployment settings after account sync and on page focus. */
export const useSharedRuntimeStore = defineStore('shared-runtime', () => {
  const enabled = ref(false)
  const canEdit = ref(false)
  const updatedAt = ref<string | null>(null)
  const cards = useAiriCardStore()
  const consciousness = useConsciousnessStore()
  const speech = useSpeechStore()
  const hearing = useHearingStore()
  const vision = useVisionStore()
  const artistry = useArtistryStore()
  const knowledgeBase = useSettingsKnowledgeBase()
  let published: SharedSettings | null = null
  let applying = false

  function currentSettings(): SharedSettings {
    return {
      cards: [...cards.cards].filter(([id]) => id !== 'default').sort(([left], [right]) => left.localeCompare(right)).map(([id, card]) => ({ id, card })),
      activeCardId: cards.activeCardId,
      models: {
        chatProvider: consciousness.activeProvider,
        chatModel: consciousness.activeModel,
        speechProvider: speech.activeSpeechProvider,
        speechModel: speech.activeSpeechModel,
        speechVoice: speech.activeSpeechVoiceId,
        hearingProvider: hearing.activeTranscriptionProvider,
        hearingModel: hearing.activeTranscriptionModel,
        visionProvider: vision.activeProvider,
        visionModel: vision.activeModel,
        artistryProvider: artistry.globalProvider,
        artistryModel: artistry.globalModel,
      },
      knowledgeBase: knowledgeBase.connections.map(connection => ({
        id: connection.id,
        name: connection.name,
        baseUrl: connection.baseUrl,
        knowledgeBaseId: connection.knowledgeBaseId,
        enabled: connection.enabled,
        scope: connection.scope,
      })),
    }
  }

  async function apply(settings: SharedSettings) {
    applying = true
    try {
      const sharedIds = new Set(settings.cards.map(({ id }) => id))
      for (const id of cards.cards.keys()) {
        if (id !== 'default' && !sharedIds.has(id))
          cards.cards.delete(id)
      }
      for (const { id, card } of settings.cards)
        cards.cards.set(id, JSON.parse(JSON.stringify(card)) as AiriCard)
      if (cards.cards.has(settings.activeCardId))
        await cards.activateCard(settings.activeCardId)
      consciousness.activeProvider = settings.models.chatProvider
      consciousness.activeModel = settings.models.chatModel
      speech.activeSpeechProvider = settings.models.speechProvider
      speech.activeSpeechModel = settings.models.speechModel
      speech.activeSpeechVoiceId = settings.models.speechVoice
      hearing.activeTranscriptionProvider = settings.models.hearingProvider
      hearing.activeTranscriptionModel = settings.models.hearingModel
      vision.activeProvider = settings.models.visionProvider
      vision.activeModel = settings.models.visionModel
      artistry.globalProvider = settings.models.artistryProvider
      artistry.globalModel = settings.models.artistryModel
      knowledgeBase.connections = settings.knowledgeBase.map(connection => ({ ...connection, apiKey: '' }))
    }
    finally {
      applying = false
    }
  }

  watch(() => JSON.stringify({ settings: currentSettings(), keys: knowledgeBase.connections.map(connection => connection.apiKey) }), (current) => {
    if (!enabled.value || canEdit.value || !published || applying)
      return
    const expected = JSON.stringify({ settings: published, keys: published.knowledgeBase.map(() => '') })
    if (current === expected)
      return
    void apply(published)
  })

  async function load() {
    const response = await requestSharedRuntime()
    if (!response.ok)
      throw new Error(`Shared settings request failed: ${response.status}`)
    const snapshot = await response.json() as Snapshot
    canEdit.value = snapshot.canEdit
    if (!snapshot.settings) {
      enabled.value = false
      published = null
      return
    }
    published = {
      ...snapshot.settings,
      cards: [...snapshot.settings.cards].sort((left, right) => left.id.localeCompare(right.id)),
    }
    updatedAt.value = snapshot.updatedAt
    await apply(published)
    enabled.value = true
  }

  async function publish() {
    if (!canEdit.value)
      throw new Error('Only the administrator can publish shared settings')
    if (knowledgeBase.connections.some(connection => connection.apiKey.trim()))
      throw new Error('知识库密钥不能发布给用户。请先改用服务端知识库代理。')
    const settings = currentSettings()
    const response = await requestSharedRuntime({
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    })
    if (!response.ok)
      throw new Error(`Shared settings save failed: ${response.status}`)
    const snapshot = await response.json() as Snapshot
    updatedAt.value = snapshot.updatedAt
    published = JSON.parse(JSON.stringify(settings)) as SharedSettings
    enabled.value = true
  }

  return { enabled, canEdit, updatedAt, load, publish }
})
