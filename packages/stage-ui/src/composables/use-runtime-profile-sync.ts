import type { AiriCard } from '../types/airiCard'

import { errorMessageFrom } from '@moeru/std'
import { ref, watch } from 'vue'

import { usePiniaSynced } from '../libs/pinia'
import {
  deleteRuntimeCard,
  fetchRuntimeProfile,
  saveRuntimeCard,
  saveRuntimeSettings,
} from '../libs/runtime-profile-api'
import { planCardSync, planFieldSync } from '../libs/runtime-profile-merge'
import { useAuthStore } from '../stores/auth'
import { useAiriCardStore } from '../stores/modules/airi-card'
import { useSettingsUserProfile } from '../stores/settings/user-profile'

const EPOCH = '1970-01-01T00:00:00.000Z'
const PUSH_DELAY_MS = 400

interface Revisions {
  cards: Record<string, string>
  activeCardUpdatedAt: string | null
  profileUpdatedAt: string | null
}

function emptyRevisions(): Revisions {
  return { cards: {}, activeCardUpdatedAt: null, profileUpdatedAt: null }
}

function revisionKey(userId: string): string {
  return `runtime-profile/revisions:${userId}`
}

function dismissKey(userId: string): string {
  return `runtime-profile/import-dismissed:${userId}`
}

function loadRevisions(userId: string): Revisions {
  try {
    const raw = localStorage.getItem(revisionKey(userId))
    if (!raw)
      return emptyRevisions()
    const parsed = JSON.parse(raw) as Partial<Revisions>
    return {
      cards: parsed.cards ?? {},
      activeCardUpdatedAt: parsed.activeCardUpdatedAt ?? null,
      profileUpdatedAt: parsed.profileUpdatedAt ?? null,
    }
  }
  catch {
    return emptyRevisions()
  }
}

function saveRevisions(userId: string, revisions: Revisions) {
  localStorage.setItem(revisionKey(userId), JSON.stringify(revisions))
}

function toCardPayload(card: unknown): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(JSON.stringify(card)) as unknown
    if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed))
      return null
    return parsed as Record<string, unknown>
  }
  catch {
    return null
  }
}

function isAiriCard(card: unknown): card is AiriCard {
  return card != null && typeof card === 'object' && !Array.isArray(card) && typeof (card as { name?: unknown }).name === 'string'
}

/**
 * Keeps character cards, the active card, and the handwritten profile in the
 * business API for the signed-in user.
 *
 * The browser copy remains. The first time an account has no saved setup, the
 * UI asks before uploading this device's copy. A later save with a newer
 * timestamp wins.
 */
export function useRuntimeProfileSync() {
  const auth = useAuthStore()
  const cards = useAiriCardStore()
  const profile = useSettingsUserProfile()
  const synced = usePiniaSynced()

  const importPromptOpen = ref(false)
  const importError = ref<string | null>(null)
  const importPending = ref(false)

  let started = false
  let applying = false
  let pushEnabled = false
  let pushTimer: ReturnType<typeof setTimeout> | undefined
  let revisions = emptyRevisions()
  const lastCardJson = new Map<string, string>()
  let lastActiveCardId = ''
  let lastProfile = ''

  function currentUserId(): string | null {
    const userId = auth.userId
    return userId && userId !== 'local' ? userId : null
  }

  function rememberLocalSnapshot() {
    lastCardJson.clear()
    for (const [id, card] of cards.cards) {
      lastCardJson.set(id, JSON.stringify(card))
    }
    lastActiveCardId = cards.activeCardId
    lastProfile = profile.content
  }

  async function waitUntilLeader(): Promise<boolean> {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      if (synced.isLeader())
        return true
      await new Promise(resolve => setTimeout(resolve, 200))
    }
    return synced.isLeader()
  }

  function applyRemoteCard(cardId: string, card: unknown, updatedAt: string) {
    if (!isAiriCard(card))
      return

    cards.cards.set(cardId, card)
    revisions.cards[cardId] = updatedAt
    if (cards.activeCardId === cardId)
      void cards.activateCard(cardId)
  }

  function removeLocalCard(cardId: string, updatedAt: string) {
    if (cardId === 'default')
      return
    cards.cards.delete(cardId)
    revisions.cards[cardId] = updatedAt
    if (cards.activeCardId === cardId)
      cards.activeCardId = 'default'
  }

  async function pushSettings(userId: string) {
    const settings = await saveRuntimeSettings({
      activeCardId: cards.activeCardId,
      activeCardUpdatedAt: revisions.activeCardUpdatedAt ?? EPOCH,
      profileContent: profile.content,
      profileUpdatedAt: revisions.profileUpdatedAt ?? EPOCH,
    })
    revisions.activeCardUpdatedAt = new Date(settings.activeCardUpdatedAt).toISOString()
    revisions.profileUpdatedAt = new Date(settings.profileUpdatedAt).toISOString()
    saveRevisions(userId, revisions)
  }

  async function pushCard(userId: string, cardId: string) {
    const card = cards.cards.get(cardId)
    const payload = card ? toCardPayload(card) : null
    const updatedAt = revisions.cards[cardId]
    if (!payload || !updatedAt)
      return

    const saved = await saveRuntimeCard(cardId, payload, updatedAt)
    const storedAt = new Date(saved.record.updatedAt).toISOString()
    revisions.cards[cardId] = storedAt
    saveRevisions(userId, revisions)
    if (!saved.applied) {
      applying = true
      try {
        applyRemoteCard(cardId, saved.record.card, storedAt)
        rememberLocalSnapshot()
      }
      finally {
        applying = false
      }
    }
  }

  async function pushDeletedCard(userId: string, cardId: string) {
    const updatedAt = revisions.cards[cardId]
    if (!updatedAt)
      return
    const saved = await deleteRuntimeCard(cardId, updatedAt)
    if (saved)
      revisions.cards[cardId] = new Date(saved.record.updatedAt).toISOString()
    saveRevisions(userId, revisions)
  }

  async function pushDirty() {
    const userId = currentUserId()
    if (!userId || !pushEnabled || !synced.isLeader())
      return

    const remote = await fetchRuntimeProfile()
    const remoteCards = new Map(remote.cards.map(card => [card.cardId, card]))
    const settings = remote.settings?.deletedAt ? null : remote.settings

    for (const [cardId] of cards.cards) {
      const action = planCardSync({
        localExists: true,
        localUpdatedAt: revisions.cards[cardId] ?? null,
        remote: remoteCards.get(cardId) ?? null,
      })
      if (action.type === 'push')
        await pushCard(userId, cardId)
    }

    for (const [cardId, updatedAt] of Object.entries(revisions.cards)) {
      if (cardId === 'default' || cards.cards.has(cardId))
        continue
      const remoteCard = remoteCards.get(cardId)
      if (remoteCard?.deletedAt)
        continue
      const remoteUpdatedAt = remoteCard ? new Date(remoteCard.updatedAt).getTime() : null
      if (remoteUpdatedAt == null || new Date(updatedAt).getTime() >= remoteUpdatedAt)
        await pushDeletedCard(userId, cardId)
    }

    const activeAction = planFieldSync({
      localUpdatedAt: revisions.activeCardUpdatedAt,
      remote: settings ? { value: settings.activeCardId, updatedAt: new Date(settings.activeCardUpdatedAt).toISOString() } : null,
    })
    const profileAction = planFieldSync({
      localUpdatedAt: revisions.profileUpdatedAt,
      remote: settings ? { value: settings.profileContent, updatedAt: new Date(settings.profileUpdatedAt).toISOString() } : null,
    })
    if (activeAction.type === 'push' || profileAction.type === 'push')
      await pushSettings(userId)
  }

  function schedulePush() {
    if (!pushEnabled)
      return
    if (pushTimer)
      clearTimeout(pushTimer)
    pushTimer = setTimeout(() => {
      pushTimer = undefined
      void pushDirty().catch(error => console.error('[runtime-profile] save failed', error))
    }, PUSH_DELAY_MS)
  }

  function noteLocalEdits() {
    if (applying || !pushEnabled)
      return

    const userId = currentUserId()
    if (!userId)
      return

    let changed = false
    const seen = new Set<string>()
    for (const [id, card] of cards.cards) {
      seen.add(id)
      const json = JSON.stringify(card)
      if (lastCardJson.get(id) !== json) {
        revisions.cards[id] = new Date().toISOString()
        lastCardJson.set(id, json)
        changed = true
      }
    }

    for (const id of [...lastCardJson.keys()]) {
      if (seen.has(id))
        continue
      revisions.cards[id] = new Date().toISOString()
      lastCardJson.delete(id)
      changed = true
    }

    if (cards.activeCardId !== lastActiveCardId) {
      revisions.activeCardUpdatedAt = new Date().toISOString()
      lastActiveCardId = cards.activeCardId
      changed = true
    }

    if (profile.content !== lastProfile) {
      revisions.profileUpdatedAt = new Date().toISOString()
      lastProfile = profile.content
      changed = true
    }

    if (!changed)
      return

    saveRevisions(userId, revisions)
    schedulePush()
  }

  async function applySnapshot(userId: string) {
    const snapshot = await fetchRuntimeProfile()
    const settings = snapshot.settings?.deletedAt ? null : snapshot.settings
    if (!settings) {
      if (sessionStorage.getItem(dismissKey(userId)) === '1')
        return
      importPromptOpen.value = true
      return
    }

    importPromptOpen.value = false
    applying = true
    try {
      const remoteCards = new Map(snapshot.cards.map(card => [card.cardId, card]))
      for (const remoteCard of snapshot.cards) {
        const action = planCardSync({
          localExists: cards.cards.has(remoteCard.cardId),
          localUpdatedAt: revisions.cards[remoteCard.cardId] ?? null,
          remote: {
            ...remoteCard,
            updatedAt: new Date(remoteCard.updatedAt).toISOString(),
            deletedAt: remoteCard.deletedAt ? new Date(remoteCard.deletedAt).toISOString() : null,
          },
        })
        if (action.type === 'apply')
          applyRemoteCard(remoteCard.cardId, action.card, action.updatedAt)
        if (action.type === 'remove')
          removeLocalCard(remoteCard.cardId, action.updatedAt)
        if (action.type === 'none' && remoteCard.deletedAt)
          revisions.cards[remoteCard.cardId] = new Date(remoteCard.deletedAt).toISOString()
      }

      for (const cardId of [...cards.cards.keys()]) {
        if (cardId === 'default' || remoteCards.has(cardId) || revisions.cards[cardId])
          continue
        cards.cards.delete(cardId)
      }

      const activeUpdatedAt = new Date(settings.activeCardUpdatedAt).toISOString()
      const profileUpdatedAt = new Date(settings.profileUpdatedAt).toISOString()
      const activeAction = planFieldSync({
        localUpdatedAt: revisions.activeCardUpdatedAt,
        remote: { value: settings.activeCardId, updatedAt: activeUpdatedAt },
      })
      const profileAction = planFieldSync({
        localUpdatedAt: revisions.profileUpdatedAt,
        remote: { value: settings.profileContent, updatedAt: profileUpdatedAt },
      })

      if (activeAction.type === 'apply' && cards.cards.has(activeAction.value)) {
        await cards.activateCard(activeAction.value)
        revisions.activeCardUpdatedAt = activeAction.updatedAt
      }
      else if (activeAction.type === 'none' || activeAction.type === 'apply') {
        revisions.activeCardUpdatedAt = activeUpdatedAt
      }

      if (profileAction.type === 'apply') {
        profile.content = profileAction.value
        revisions.profileUpdatedAt = profileAction.updatedAt
      }
      else if (profileAction.type === 'none') {
        revisions.profileUpdatedAt = profileUpdatedAt
      }

      saveRevisions(userId, revisions)
      rememberLocalSnapshot()
      pushEnabled = true
    }
    finally {
      applying = false
    }

    schedulePush()
  }

  async function acceptImport() {
    const userId = currentUserId()
    if (!userId)
      return

    importPending.value = true
    importError.value = null
    const now = new Date().toISOString()
    try {
      applying = true
      for (const [cardId, card] of cards.cards) {
        const payload = toCardPayload(card)
        if (!payload)
          continue
        revisions.cards[cardId] = now
        await saveRuntimeCard(cardId, payload, now)
      }
      revisions.activeCardUpdatedAt = now
      revisions.profileUpdatedAt = now
      await saveRuntimeSettings({
        activeCardId: cards.activeCardId,
        activeCardUpdatedAt: now,
        profileContent: profile.content,
        profileUpdatedAt: now,
      })
      saveRevisions(userId, revisions)
      rememberLocalSnapshot()
      pushEnabled = true
      importPromptOpen.value = false
      sessionStorage.removeItem(dismissKey(userId))
    }
    catch (error) {
      importError.value = errorMessageFrom(error) ?? 'Save failed'
    }
    finally {
      applying = false
      importPending.value = false
    }
  }

  function dismissImport() {
    const userId = currentUserId()
    if (userId)
      sessionStorage.setItem(dismissKey(userId), '1')
    importPromptOpen.value = false
    importError.value = null
  }

  async function reconcile() {
    const userId = currentUserId()
    pushEnabled = false
    importPromptOpen.value = false
    if (!userId)
      return
    if (!await waitUntilLeader())
      return

    revisions = loadRevisions(userId)
    try {
      await applySnapshot(userId)
    }
    catch (error) {
      console.error('[runtime-profile] load failed', error)
    }
  }

  function start() {
    if (started)
      return
    started = true

    watch(() => auth.userId, () => {
      void reconcile()
    }, { immediate: true })

    watch(() => cards.cards, () => noteLocalEdits(), { deep: true })
    watch(() => cards.activeCardId, () => noteLocalEdits())
    watch(() => profile.content, () => noteLocalEdits())
  }

  return {
    start,
    importPromptOpen,
    importError,
    importPending,
    acceptImport,
    dismissImport,
  }
}
