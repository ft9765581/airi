import type { AccountSections } from '../libs/account-settings'

import { errorMessageFrom } from '@moeru/std'
import {
  expressionSettingsEqual,
  expressionSettingsSignature,
  expressionSettingsUpdatedAt,
  hasExpressionChoices,
  loadPersistedExpressionSettings,
  useExpressionStore,
} from '@proj-airi/stage-ui-live2d'
import { ref, watch } from 'vue'

import { hasAccountSections, liftStoredCardOverride } from '../libs/account-settings'
import {
  applyCardOverride,
  applyConnection,
  applyKnowledgeBase,
  applyModelExpressions,
  applyModelView,
  applyModules,
  applyScenes,
  applySystem,
  readActiveCardId,
  readActiveCardOverride,
  readConnectionBody,
  readKnowledgeBaseBody,
  readModelExpressionBodies,
  readModelViewBody,
  readModulesBody,
  readProfileContent,
  readSceneBodies,
  readSystemBody,
} from '../libs/account-settings-state'
import { usePiniaSynced } from '../libs/pinia'
import { fetchRuntimeProfile, saveRuntimeSettings } from '../libs/runtime-profile-api'
import { planExpressionSync, planFieldSync, shouldAskRuntimeImport, shouldWriteAccountField } from '../libs/runtime-profile-merge'
import { useAuthStore } from '../stores/auth'
import { useBackgroundStore } from '../stores/background'
import { useAiriCardStore } from '../stores/modules/airi-card'
import { configureAsDefaultsIfEmpty } from '../stores/modules/default'
import { useSettingsUserProfile } from '../stores/settings/user-profile'

const EPOCH = '1970-01-01T00:00:00.000Z'
const PUSH_DELAY_MS = 400

interface Revisions {
  activeCardUpdatedAt: string | null
  profileUpdatedAt: string | null
  modulesUpdatedAt: string | null
  knowledgeBaseUpdatedAt: string | null
  connectionUpdatedAt: string | null
  systemUpdatedAt: string | null
  modelViewUpdatedAt: string | null
  cardSpeech: Record<string, string>
  cardScene: Record<string, string>
  cardDisplayModel: Record<string, string>
  scenes: Record<string, string>
  sceneDeletes: Record<string, string>
  modelExpressions: Record<string, string>
}

function emptyRevisions(): Revisions {
  return {
    activeCardUpdatedAt: null,
    profileUpdatedAt: null,
    modulesUpdatedAt: null,
    knowledgeBaseUpdatedAt: null,
    connectionUpdatedAt: null,
    systemUpdatedAt: null,
    modelViewUpdatedAt: null,
    cardSpeech: {},
    cardScene: {},
    cardDisplayModel: {},
    scenes: {},
    sceneDeletes: {},
    modelExpressions: {},
  }
}

function revisionKey(userId: string): string {
  return `runtime-profile/revisions:${userId}`
}

function importChoiceKey(userId: string): string {
  return `runtime-profile/import-choice:${userId}`
}

function readImportChoice(userId: string): string | null {
  try {
    return localStorage.getItem(importChoiceKey(userId))
  }
  catch {
    return null
  }
}

function writeImportChoice(userId: string, choice: 'dismissed' | 'saved') {
  try {
    localStorage.setItem(importChoiceKey(userId), choice)
  }
  catch {
    // A blocked or full storage cannot keep the choice. The question can show on the next load.
  }
}

function loadRevisions(userId: string): Revisions {
  try {
    const raw = localStorage.getItem(revisionKey(userId))
    if (!raw)
      return emptyRevisions()
    const parsed = JSON.parse(raw) as Partial<Revisions>
    return {
      ...emptyRevisions(),
      ...parsed,
      cardSpeech: parsed.cardSpeech ?? {},
      cardScene: parsed.cardScene ?? {},
      cardDisplayModel: parsed.cardDisplayModel ?? {},
      scenes: parsed.scenes ?? {},
      sceneDeletes: parsed.sceneDeletes ?? {},
      modelExpressions: parsed.modelExpressions ?? {},
    }
  }
  catch {
    return emptyRevisions()
  }
}

function saveRevisions(userId: string, revisions: Revisions) {
  localStorage.setItem(revisionKey(userId), JSON.stringify(revisions))
}

function iso(value: string | Date): string {
  return new Date(value).toISOString()
}

/**
 * Keeps account settings on the business API for the signed-in user.
 *
 * The browser copy remains. The first time an account has no saved setup, the
 * UI asks before uploading this device's copy. That question is once for each
 * account in this browser. A later save with a newer timestamp wins. Whole
 * character cards are not uploaded.
 */
export function useRuntimeProfileSync() {
  const auth = useAuthStore()
  const cards = useAiriCardStore()
  const profile = useSettingsUserProfile()
  const backgrounds = useBackgroundStore()
  const expressionStore = useExpressionStore()
  const synced = usePiniaSynced()

  const importPromptOpen = ref(false)
  const importError = ref<string | null>(null)
  const importPending = ref(false)

  let started = false
  let startup: Promise<void> = Promise.resolve()
  let applying = false
  let pushEnabled = false
  let pushTimer: ReturnType<typeof setTimeout> | undefined
  let stopLeadershipWatch: (() => void) | undefined
  let revisions = emptyRevisions()
  let lastModules = ''
  let lastKnowledge = ''
  let lastConnection = ''
  let lastSystem = ''
  let lastModelView = ''
  let lastActiveCardId = ''
  let lastProfile = ''
  let lastSpeech = ''
  let lastScene = ''
  let lastDisplayModel = ''
  let lastDisplayExpressions = ''
  let lastSceneSignature = ''
  let lastExpressionSignature = ''

  function currentUserId(): string | null {
    const userId = auth.userId
    return userId && userId !== 'local' ? userId : null
  }

  function sceneSignature(): string {
    return [...backgrounds.entries.values()]
      .filter(entry => entry.type === 'scene')
      .map(entry => `${entry.id}:${entry.blob.size}:${entry.title}`)
      .sort()
      .join('|')
  }

  function rememberLocalSnapshot() {
    lastModules = JSON.stringify(readModulesBody())
    lastKnowledge = JSON.stringify(readKnowledgeBaseBody())
    lastConnection = JSON.stringify(readConnectionBody())
    lastSystem = JSON.stringify(readSystemBody())
    lastModelView = JSON.stringify(readModelViewBody())
    lastActiveCardId = readActiveCardId()
    lastProfile = readProfileContent()
    const override = readActiveCardOverride()
    lastSpeech = JSON.stringify(override?.speech ?? null)
    lastScene = override?.scene.backgroundId ?? ''
    lastDisplayModel = override?.displayModelId ?? ''
    lastDisplayExpressions = override?.displayModelId
      ? JSON.stringify(loadPersistedExpressionSettings(override.displayModelId))
      : ''
    lastSceneSignature = sceneSignature()
    lastExpressionSignature = expressionSettingsSignature()
  }

  function displayModelPayload(override: NonNullable<ReturnType<typeof readActiveCardOverride>>) {
    if (!override.displayModelId)
      return null
    const expressions = override.displayModelExpressions
      ?? loadPersistedExpressionSettings(override.displayModelId)
    return {
      modelId: override.displayModelId,
      llmMode: expressions.llmMode,
      llmExposed: expressions.llmExposed,
      defaults: expressions.defaults,
      values: expressions.values,
      activeGroups: expressions.activeGroups,
    }
  }

  function expressionSettingsMatch(
    modelId: string,
    remote: NonNullable<NonNullable<AccountSections['cardOverrides']>[number]['displayModel']>,
  ): boolean {
    // A displayModel row that only stores the model id has no expression
    // payload to apply. Skip the write so local preview toggles stay put.
    if (remote.llmMode == null && !remote.llmExposed && !remote.defaults && !remote.values && !remote.activeGroups)
      return true
    const local = loadPersistedExpressionSettings(modelId)
    return expressionSettingsEqual(local, {
      llmMode: remote.llmMode ?? 'none',
      llmExposed: remote.llmExposed ?? {},
      defaults: remote.defaults ?? {},
      values: remote.values ?? {},
      activeGroups: remote.activeGroups ?? {},
    })
  }

  function remoteExpressionSettings(
    remote: NonNullable<AccountSections['modelExpressions']>[number] | NonNullable<NonNullable<AccountSections['cardOverrides']>[number]['displayModel']> | undefined,
  ) {
    if (!remote)
      return null
    if (!('llmMode' in remote) && !('llmExposed' in remote) && !('defaults' in remote) && !('values' in remote) && !('activeGroups' in remote))
      return null
    if (remote.llmMode == null && !remote.llmExposed && !remote.defaults && !remote.values && !remote.activeGroups)
      return null
    return {
      llmMode: remote.llmMode ?? 'none' as const,
      llmExposed: remote.llmExposed ?? {},
      defaults: remote.defaults ?? {},
      values: remote.values ?? {},
      activeGroups: remote.activeGroups ?? {},
    }
  }

  /**
   * Stamps local expression blobs that the account is missing or that differ.
   *
   * ROOT CAUSE:
   * Chrome could keep expression toggles only in localStorage. After sign-in,
   * applySnapshot called schedulePush, but collectPushSections skipped every
   * model whose revision timestamp was still null. The account never received
   * modelExpressions, so a second browser stayed empty.
   */
  function preferredIso(left: string, right: string): string {
    return new Date(left).getTime() >= new Date(right).getTime() ? left : right
  }

  /**
   * Resolves the local expression edit time.
   *
   * Prefer the blob's own `updatedAt`. Do not invent "now" for idle browsers —
   * that let Cursor upload empty checkboxes with a fresher time than Chrome.
   */
  function localExpressionUpdatedAt(modelId: string): string | null {
    const local = loadPersistedExpressionSettings(modelId)
    const blobTime = expressionSettingsUpdatedAt(local)
    const revisionTime = revisions.modelExpressions[modelId] ?? null
    if (blobTime && revisionTime)
      return preferredIso(blobTime, revisionTime)
    return blobTime ?? revisionTime
  }

  function markUnsyncedLocalExpressions(remote: AccountSections): boolean {
    let changed = false

    for (const local of readModelExpressionBodies()) {
      if (!hasExpressionChoices(local))
        continue
      const remoteItem = remote.modelExpressions?.find(item => item.modelId === local.modelId)
      const remoteSettings = remoteExpressionSettings(remoteItem)
      const localUpdatedAt = localExpressionUpdatedAt(local.modelId)
      const action = planExpressionSync({
        localUpdatedAt,
        localHasChoices: true,
        remoteHasChoices: remoteSettings ? hasExpressionChoices(remoteSettings) : false,
        contentEqual: remoteSettings ? expressionSettingsEqual(local, remoteSettings) : false,
        remote: remoteItem
          ? { value: remoteItem, updatedAt: remoteItem.updatedAt }
          : null,
      })
      if (action.type !== 'push')
        continue
      const stamp = localUpdatedAt ?? new Date().toISOString()
      revisions.modelExpressions[local.modelId] = stamp
      changed = true
    }

    const override = readActiveCardOverride()
    if (override?.displayModelId && override.displayModelExpressions && hasExpressionChoices(override.displayModelExpressions)) {
      const remoteOverride = remote.cardOverrides?.find(item => item.cardId === override.cardId)
      const remoteSettings = remoteExpressionSettings(remoteOverride?.displayModel)
      const localUpdatedAt = localExpressionUpdatedAt(override.displayModelId)
        ?? revisions.cardDisplayModel[override.cardId]
        ?? null
      const action = planExpressionSync({
        localUpdatedAt,
        localHasChoices: true,
        remoteHasChoices: remoteSettings ? hasExpressionChoices(remoteSettings) : false,
        contentEqual: remoteSettings
          ? expressionSettingsEqual(override.displayModelExpressions, remoteSettings)
          : false,
        remote: remoteOverride?.displayModel
          ? { value: remoteOverride.displayModel, updatedAt: remoteOverride.displayModel.updatedAt }
          : null,
      })
      if (action.type === 'push') {
        revisions.cardDisplayModel[override.cardId] = localUpdatedAt ?? new Date().toISOString()
        changed = true
      }
    }

    return changed
  }

  function remoteSections(settings: { sections?: AccountSections } | null): AccountSections {
    return settings?.sections ?? {}
  }

  async function pushSettings(userId: string, sections: AccountSections | undefined) {
    const settings = await saveRuntimeSettings({
      activeCardId: readActiveCardId(),
      activeCardUpdatedAt: revisions.activeCardUpdatedAt ?? EPOCH,
      profileContent: readProfileContent(),
      profileUpdatedAt: revisions.profileUpdatedAt ?? EPOCH,
      ...(sections && Object.keys(sections).length > 0 ? { sections } : {}),
    })
    revisions.activeCardUpdatedAt = iso(settings.activeCardUpdatedAt)
    revisions.profileUpdatedAt = iso(settings.profileUpdatedAt)
    const saved = settings.sections ?? {}
    if (saved.modules)
      revisions.modulesUpdatedAt = saved.modules.updatedAt
    if (saved.knowledgeBase)
      revisions.knowledgeBaseUpdatedAt = saved.knowledgeBase.updatedAt
    if (saved.connection)
      revisions.connectionUpdatedAt = saved.connection.updatedAt
    if (saved.system)
      revisions.systemUpdatedAt = saved.system.updatedAt
    if (saved.modelView)
      revisions.modelViewUpdatedAt = saved.modelView.updatedAt
    for (const override of saved.cardOverrides ?? []) {
      if (override.speech)
        revisions.cardSpeech[override.cardId] = override.speech.updatedAt
      if (override.scene)
        revisions.cardScene[override.cardId] = override.scene.updatedAt
      if (override.displayModel)
        revisions.cardDisplayModel[override.cardId] = override.displayModel.updatedAt
    }
    for (const scene of saved.scenes ?? [])
      revisions.scenes[scene.id] = scene.updatedAt
    for (const expression of saved.modelExpressions ?? [])
      revisions.modelExpressions[expression.modelId] = expression.updatedAt
    saveRevisions(userId, revisions)
  }

  async function collectPushSections(remote: AccountSections): Promise<AccountSections> {
    const sections: AccountSections = {}
    const modulesAction = planFieldSync({
      localUpdatedAt: revisions.modulesUpdatedAt,
      remote: remote.modules ? { value: remote.modules, updatedAt: remote.modules.updatedAt } : null,
    })
    if (modulesAction.type === 'push' && revisions.modulesUpdatedAt)
      sections.modules = { ...readModulesBody(), updatedAt: revisions.modulesUpdatedAt }

    const knowledgeAction = planFieldSync({
      localUpdatedAt: revisions.knowledgeBaseUpdatedAt,
      remote: remote.knowledgeBase ? { value: remote.knowledgeBase, updatedAt: remote.knowledgeBase.updatedAt } : null,
    })
    if (knowledgeAction.type === 'push' && revisions.knowledgeBaseUpdatedAt)
      sections.knowledgeBase = { ...readKnowledgeBaseBody(), updatedAt: revisions.knowledgeBaseUpdatedAt }

    const connectionAction = planFieldSync({
      localUpdatedAt: revisions.connectionUpdatedAt,
      remote: remote.connection ? { value: remote.connection, updatedAt: remote.connection.updatedAt } : null,
    })
    if (connectionAction.type === 'push' && revisions.connectionUpdatedAt)
      sections.connection = { ...readConnectionBody(), updatedAt: revisions.connectionUpdatedAt }

    const systemAction = planFieldSync({
      localUpdatedAt: revisions.systemUpdatedAt,
      remote: remote.system ? { value: remote.system, updatedAt: remote.system.updatedAt } : null,
    })
    if (systemAction.type === 'push' && revisions.systemUpdatedAt)
      sections.system = { ...readSystemBody(), updatedAt: revisions.systemUpdatedAt }

    const modelAction = planFieldSync({
      localUpdatedAt: revisions.modelViewUpdatedAt,
      remote: remote.modelView ? { value: remote.modelView, updatedAt: remote.modelView.updatedAt } : null,
    })
    if (modelAction.type === 'push' && revisions.modelViewUpdatedAt)
      sections.modelView = { ...readModelViewBody(), updatedAt: revisions.modelViewUpdatedAt }

    const override = readActiveCardOverride()
    if (override) {
      const remoteOverride = remote.cardOverrides?.find(item => item.cardId === override.cardId)
      const speechAt = revisions.cardSpeech[override.cardId] ?? null
      const sceneAt = revisions.cardScene[override.cardId] ?? null
      const modelAt = revisions.cardDisplayModel[override.cardId] ?? null
      const speechAction = planFieldSync({
        localUpdatedAt: speechAt,
        remote: remoteOverride?.speech ? { value: remoteOverride.speech, updatedAt: remoteOverride.speech.updatedAt } : null,
      })
      const sceneAction = planFieldSync({
        localUpdatedAt: sceneAt,
        remote: remoteOverride?.scene ? { value: remoteOverride.scene, updatedAt: remoteOverride.scene.updatedAt } : null,
      })
      const displayAction = planFieldSync({
        localUpdatedAt: modelAt,
        remote: remoteOverride?.displayModel
          ? { value: remoteOverride.displayModel, updatedAt: remoteOverride.displayModel.updatedAt }
          : null,
      })
      const next: NonNullable<AccountSections['cardOverrides']>[number] = { cardId: override.cardId }
      if (speechAction.type === 'push' && speechAt)
        next.speech = { ...override.speech, updatedAt: speechAt }
      if (sceneAction.type === 'push' && sceneAt)
        next.scene = { backgroundId: override.scene.backgroundId, updatedAt: sceneAt }
      if (displayAction.type === 'push' && modelAt && override.displayModelId) {
        const payload = displayModelPayload(override)
        if (payload) {
          const remoteExpr = remoteExpressionSettings(remoteOverride?.displayModel)
          // Never let an empty local expression dump ride along on a newer
          // displayModel timestamp and erase account checkboxes.
          if (!hasExpressionChoices(payload) && remoteExpr && hasExpressionChoices(remoteExpr)) {
            next.displayModel = {
              modelId: payload.modelId,
              llmMode: remoteOverride!.displayModel!.llmMode,
              llmExposed: remoteOverride!.displayModel!.llmExposed,
              defaults: remoteOverride!.displayModel!.defaults,
              values: remoteOverride!.displayModel!.values,
              activeGroups: remoteOverride!.displayModel!.activeGroups,
              updatedAt: modelAt,
            }
          }
          else {
            next.displayModel = { ...payload, updatedAt: modelAt }
          }
        }
      }
      if (next.speech || next.scene || next.displayModel)
        sections.cardOverrides = [next]
    }

    const sceneBodies = await readSceneBodies()
    const sceneSaves = []
    for (const scene of sceneBodies) {
      const localUpdatedAt = revisions.scenes[scene.id] ?? null
      const remoteScene = remote.scenes?.find(item => item.id === scene.id)
      const action = planFieldSync({
        localUpdatedAt,
        remote: remoteScene ? { value: remoteScene, updatedAt: remoteScene.updatedAt } : null,
      })
      if (action.type === 'push' && localUpdatedAt)
        sceneSaves.push({ ...scene, updatedAt: localUpdatedAt })
    }
    for (const [id, deletedAt] of Object.entries(revisions.sceneDeletes)) {
      if (sceneBodies.some(scene => scene.id === id))
        continue
      const remoteScene = remote.scenes?.find(item => item.id === id)
      if (remoteScene?.deletedAt)
        continue
      sceneSaves.push({
        id,
        title: remoteScene?.title ?? '',
        mimeType: remoteScene?.mimeType ?? 'application/octet-stream',
        data: '',
        updatedAt: deletedAt,
        deletedAt,
      })
    }
    if (sceneSaves.length > 0)
      sections.scenes = sceneSaves

    const expressionBodies = readModelExpressionBodies()
    const expressionSaves = []
    const now = new Date().toISOString()
    for (const expression of expressionBodies) {
      const localUpdatedAt = localExpressionUpdatedAt(expression.modelId)
      const remoteExpression = remote.modelExpressions?.find(item => item.modelId === expression.modelId)
      const remoteSettings = remoteExpressionSettings(remoteExpression)
      const action = planExpressionSync({
        localUpdatedAt,
        localHasChoices: hasExpressionChoices(expression),
        remoteHasChoices: remoteSettings ? hasExpressionChoices(remoteSettings) : false,
        contentEqual: remoteSettings
          ? expressionSettingsEqual(expression, remoteSettings)
          : !hasExpressionChoices(expression),
        remote: remoteExpression
          ? { value: remoteExpression, updatedAt: remoteExpression.updatedAt }
          : null,
      })
      if (action.type !== 'push')
        continue
      const updatedAt = localUpdatedAt ?? now
      revisions.modelExpressions[expression.modelId] = updatedAt
      expressionSaves.push({ ...expression, updatedAt })
    }
    if (expressionSaves.length > 0)
      sections.modelExpressions = expressionSaves

    return sections
  }

  async function pushDirty() {
    const userId = currentUserId()
    if (!userId || !pushEnabled)
      return

    // NOTICE:
    // Account settings sync talks to the business API, not the Pinia election.
    // A follower tab that edits expressions used to call schedulePush and then
    // bail here, so Chrome never uploaded and Cursor never saw the change.
    // The API already merges by timestamp, so every tab may push.
    // Removal condition: keep unless pinia-plugin-synced gains a required
    // single-writer API for cross-origin account settings.

    const remote = await fetchRuntimeProfile()
    const settings = remote.settings?.deletedAt ? null : remote.settings
    const sections = remoteSections(settings)
    if (markUnsyncedLocalExpressions(sections))
      saveRevisions(userId, revisions)
    const activeAction = planFieldSync({
      localUpdatedAt: revisions.activeCardUpdatedAt,
      remote: settings ? { value: settings.activeCardId, updatedAt: iso(settings.activeCardUpdatedAt) } : null,
    })
    const profileAction = planFieldSync({
      localUpdatedAt: revisions.profileUpdatedAt,
      remote: settings ? { value: settings.profileContent, updatedAt: iso(settings.profileUpdatedAt) } : null,
    })
    const payload = await collectPushSections(sections)
    const hasSections = Object.keys(payload).length > 0
    if (activeAction.type === 'push' || profileAction.type === 'push' || hasSections)
      await pushSettings(userId, hasSections ? payload : undefined)
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

    const now = new Date().toISOString()
    let changed = false

    const modules = JSON.stringify(readModulesBody())
    if (modules !== lastModules) {
      revisions.modulesUpdatedAt = now
      lastModules = modules
      changed = true
    }
    const knowledge = JSON.stringify(readKnowledgeBaseBody())
    if (knowledge !== lastKnowledge) {
      revisions.knowledgeBaseUpdatedAt = now
      lastKnowledge = knowledge
      changed = true
    }
    const connection = JSON.stringify(readConnectionBody())
    if (connection !== lastConnection) {
      revisions.connectionUpdatedAt = now
      lastConnection = connection
      changed = true
    }
    const system = JSON.stringify(readSystemBody())
    if (system !== lastSystem) {
      revisions.systemUpdatedAt = now
      lastSystem = system
      changed = true
    }
    const modelView = JSON.stringify(readModelViewBody())
    if (modelView !== lastModelView) {
      revisions.modelViewUpdatedAt = now
      lastModelView = modelView
      changed = true
    }

    const activeCardId = readActiveCardId()
    const cardChanged = activeCardId !== lastActiveCardId
    if (cardChanged) {
      revisions.activeCardUpdatedAt = now
      lastActiveCardId = activeCardId
      changed = true
    }
    const profileText = readProfileContent()
    if (profileText !== lastProfile) {
      revisions.profileUpdatedAt = now
      lastProfile = profileText
      changed = true
    }

    const override = readActiveCardOverride()
    if (override && !cardChanged) {
      const speech = JSON.stringify(override.speech)
      if (speech !== lastSpeech) {
        revisions.cardSpeech[override.cardId] = now
        lastSpeech = speech
        changed = true
      }
      if (override.scene.backgroundId !== lastScene) {
        revisions.cardScene[override.cardId] = now
        lastScene = override.scene.backgroundId
        changed = true
      }
      const displayModelId = override.displayModelId ?? ''
      const displayExpressionSettings = displayModelId
        ? loadPersistedExpressionSettings(displayModelId)
        : null
      const displayExpressions = displayExpressionSettings
        ? JSON.stringify(displayExpressionSettings)
        : ''
      const displayModelChanged = displayModelId !== lastDisplayModel
      const displayExpressionsChanged = displayExpressions !== lastDisplayExpressions
      // Only bump the display-model revision for expression edits that carry a
      // real choice. Idle parameter dumps used to mint a newer timestamp and
      // upload empty checkboxes over Chrome's account copy.
      const expressionEditMatters = displayExpressionSettings != null
        && hasExpressionChoices(displayExpressionSettings)
      if (displayModelChanged || (displayExpressionsChanged && (displayModelChanged || expressionEditMatters))) {
        revisions.cardDisplayModel[override.cardId] = now
        lastDisplayModel = displayModelId
        lastDisplayExpressions = displayExpressions
        changed = true
      }
      else if (displayExpressionsChanged) {
        lastDisplayExpressions = displayExpressions
      }
    }
    else if (override) {
      lastSpeech = JSON.stringify(override.speech)
      lastScene = override.scene.backgroundId
      lastDisplayModel = override.displayModelId ?? ''
      lastDisplayExpressions = override.displayModelId
        ? JSON.stringify(loadPersistedExpressionSettings(override.displayModelId))
        : ''
    }

    const signature = sceneSignature()
    if (signature !== lastSceneSignature) {
      const currentParts = new Map(signature.split('|').filter(Boolean).map(part => [part.split(':')[0]!, part]))
      const previousParts = new Map(lastSceneSignature.split('|').filter(Boolean).map(part => [part.split(':')[0]!, part]))
      for (const [id, part] of currentParts) {
        if (previousParts.get(id) !== part) {
          revisions.scenes[id] = now
          delete revisions.sceneDeletes[id]
        }
      }
      for (const id of previousParts.keys()) {
        if (!currentParts.has(id))
          revisions.sceneDeletes[id] = now
      }
      lastSceneSignature = signature
      changed = true
    }

    const expressionSignature = expressionSettingsSignature()
    if (expressionSignature !== lastExpressionSignature) {
      const currentParts = new Map(
        expressionSignature.split('|').filter(Boolean).map((part) => {
          const modelId = part.slice(0, part.indexOf(':'))
          return [modelId, part] as const
        }),
      )
      const previousParts = new Map(
        lastExpressionSignature.split('|').filter(Boolean).map((part) => {
          const modelId = part.slice(0, part.indexOf(':'))
          return [modelId, part] as const
        }),
      )
      let expressionChanged = false
      for (const [modelId, part] of currentParts) {
        if (previousParts.get(modelId) === part)
          continue
        const local = loadPersistedExpressionSettings(modelId)
        if (!hasExpressionChoices(local))
          continue
        // Prefer the blob stamp from persistCurrentSettings so the upload time
        // matches the checkbox edit, not a later idle remount.
        revisions.modelExpressions[modelId] = local.updatedAt ?? now
        expressionChanged = true
      }
      lastExpressionSignature = expressionSignature
      if (expressionChanged)
        changed = true
    }

    if (!changed)
      return

    saveRevisions(userId, revisions)
    schedulePush()
  }

  function cardModules(cardId: string) {
    return cards.cards.get(cardId)?.extensions?.airi?.modules
  }

  function speechMatches(cardId: string, speech: NonNullable<NonNullable<AccountSections['cardOverrides']>[number]['speech']>): boolean {
    const current = cardModules(cardId)?.speech
    return current?.provider === speech.provider
      && current?.model === speech.model
      && (current?.voice_id ?? '') === speech.voiceId
      && (current?.pitch ?? 0) === speech.pitch
      && (current?.rate ?? 1) === speech.rate
      && (current?.ssml ?? false) === speech.ssml
  }

  function sceneMatches(cardId: string, backgroundId: string): boolean {
    return (cardModules(cardId)?.activeBackgroundId || 'none') === backgroundId
  }

  function displayModelMatches(cardId: string, modelId: string): boolean {
    return (cardModules(cardId)?.displayModelId ?? '') === modelId
  }

  async function applyRemoteSections(sections: AccountSections) {
    for (const override of sections.cardOverrides ?? []) {
      // The signed-in account owns the voice, scene, display model, and
      // expression choices. A stale local revision time used to skip these
      // writes, so another browser kept its own model and scene after every
      // refresh. Expression settings must follow the same force-apply path.
      const next: NonNullable<AccountSections['cardOverrides']>[number] = { cardId: override.cardId }
      if (override.speech && !speechMatches(override.cardId, override.speech))
        next.speech = override.speech
      if (override.scene && !sceneMatches(override.cardId, override.scene.backgroundId))
        next.scene = override.scene
      if (override.displayModel) {
        const modelSame = displayModelMatches(override.cardId, override.displayModel.modelId)
        const local = loadPersistedExpressionSettings(override.displayModel.modelId)
        const remoteSettings = remoteExpressionSettings(override.displayModel)
        const expressionAction = remoteSettings
          ? planExpressionSync({
              localUpdatedAt: localExpressionUpdatedAt(override.displayModel.modelId)
                ?? revisions.cardDisplayModel[override.cardId]
                ?? null,
              localHasChoices: hasExpressionChoices(local),
              remoteHasChoices: hasExpressionChoices(remoteSettings),
              contentEqual: expressionSettingsEqual(local, remoteSettings),
              remote: { value: override.displayModel, updatedAt: override.displayModel.updatedAt },
            })
          : expressionSettingsMatch(override.displayModel.modelId, override.displayModel)
            ? { type: 'none' as const }
            : { type: 'apply' as const }
        if (!modelSame || expressionAction.type === 'apply')
          next.displayModel = override.displayModel
      }
      if (next.speech || next.scene || next.displayModel)
        await applyCardOverride(next)
      if (override.speech && speechMatches(override.cardId, override.speech))
        revisions.cardSpeech[override.cardId] = override.speech.updatedAt
      if (override.scene && sceneMatches(override.cardId, override.scene.backgroundId))
        revisions.cardScene[override.cardId] = override.scene.updatedAt
      if (override.displayModel
        && displayModelMatches(override.cardId, override.displayModel.modelId)
        && expressionSettingsMatch(override.displayModel.modelId, override.displayModel)) {
        revisions.cardDisplayModel[override.cardId] = override.displayModel.updatedAt
      }
    }

    if (sections.modules) {
      const action = planFieldSync({
        localUpdatedAt: revisions.modulesUpdatedAt,
        remote: { value: sections.modules, updatedAt: sections.modules.updatedAt },
      })
      if (action.type === 'apply')
        await applyModules(sections.modules)
      if (action.type === 'apply' || action.type === 'none')
        revisions.modulesUpdatedAt = sections.modules.updatedAt
    }
    if (sections.knowledgeBase) {
      const action = planFieldSync({
        localUpdatedAt: revisions.knowledgeBaseUpdatedAt,
        remote: { value: sections.knowledgeBase, updatedAt: sections.knowledgeBase.updatedAt },
      })
      if (action.type === 'apply')
        applyKnowledgeBase(sections.knowledgeBase)
      if (action.type === 'apply' || action.type === 'none')
        revisions.knowledgeBaseUpdatedAt = sections.knowledgeBase.updatedAt
    }
    if (sections.connection) {
      const action = planFieldSync({
        localUpdatedAt: revisions.connectionUpdatedAt,
        remote: { value: sections.connection, updatedAt: sections.connection.updatedAt },
      })
      if (action.type === 'apply')
        applyConnection(sections.connection)
      if (action.type === 'apply' || action.type === 'none')
        revisions.connectionUpdatedAt = sections.connection.updatedAt
    }
    if (sections.system) {
      const action = planFieldSync({
        localUpdatedAt: revisions.systemUpdatedAt,
        remote: { value: sections.system, updatedAt: sections.system.updatedAt },
      })
      if (action.type === 'apply')
        applySystem(sections.system)
      if (action.type === 'apply' || action.type === 'none')
        revisions.systemUpdatedAt = sections.system.updatedAt
    }
    if (sections.modelView) {
      const action = planFieldSync({
        localUpdatedAt: revisions.modelViewUpdatedAt,
        remote: { value: sections.modelView, updatedAt: sections.modelView.updatedAt },
      })
      if (action.type === 'apply')
        applyModelView(sections.modelView)
      if (action.type === 'apply' || action.type === 'none')
        revisions.modelViewUpdatedAt = sections.modelView.updatedAt
    }

    const scenesToApply = (sections.scenes ?? []).filter((scene) => {
      const action = planFieldSync({
        localUpdatedAt: revisions.scenes[scene.id] ?? revisions.sceneDeletes[scene.id] ?? null,
        remote: { value: scene, updatedAt: scene.updatedAt },
      })
      if (action.type !== 'push')
        revisions.scenes[scene.id] = scene.updatedAt
      return action.type === 'apply'
    })
    if (scenesToApply.length > 0)
      await applyScenes(scenesToApply)

    // Expression blobs use content-aware LWW. Unstamped local checkboxes must
    // push, not get overwritten by an older account copy on every reload.
    const expressionsToApply = (sections.modelExpressions ?? []).filter((expression) => {
      const local = loadPersistedExpressionSettings(expression.modelId)
      const remoteSettings = {
        llmMode: expression.llmMode,
        llmExposed: expression.llmExposed,
        defaults: expression.defaults,
        values: expression.values,
        activeGroups: expression.activeGroups ?? {},
      }
      const action = planExpressionSync({
        localUpdatedAt: localExpressionUpdatedAt(expression.modelId),
        localHasChoices: hasExpressionChoices(local),
        remoteHasChoices: hasExpressionChoices(remoteSettings),
        contentEqual: expressionSettingsEqual(local, remoteSettings),
        remote: { value: expression, updatedAt: expression.updatedAt },
      })
      if (action.type === 'apply') {
        revisions.modelExpressions[expression.modelId] = expression.updatedAt
        return true
      }
      if (action.type === 'none')
        revisions.modelExpressions[expression.modelId] = expression.updatedAt
      return false
    })
    if (expressionsToApply.length > 0)
      applyModelExpressions(expressionsToApply)
  }

  async function applySnapshot(userId: string) {
    const snapshot = await fetchRuntimeProfile()
    const settings = snapshot.settings?.deletedAt ? null : snapshot.settings
    if (!settings) {
      // Ask once. A reload must not open this dialog again.
      if (!shouldAskRuntimeImport({ hasSettingsRow: false, storedChoice: readImportChoice(userId) }))
        return
      writeImportChoice(userId, 'dismissed')
      importPromptOpen.value = true
      return
    }

    const activeUpdatedAt = iso(settings.activeCardUpdatedAt)
    const profileUpdatedAt = iso(settings.profileUpdatedAt)
    const activeAction = planFieldSync({
      localUpdatedAt: revisions.activeCardUpdatedAt,
      remote: { value: settings.activeCardId, updatedAt: activeUpdatedAt },
    })
    const profileAction = planFieldSync({
      localUpdatedAt: revisions.profileUpdatedAt,
      remote: { value: settings.profileContent, updatedAt: profileUpdatedAt },
    })

    if (shouldWriteAccountField(activeAction.type, readActiveCardId() === settings.activeCardId) && cards.cards.has(settings.activeCardId))
      await cards.activateCard(settings.activeCardId)
    if (activeAction.type !== 'push' && readActiveCardId() === settings.activeCardId)
      revisions.activeCardUpdatedAt = activeUpdatedAt

    if (profileAction.type === 'apply') {
      profile.content = profileAction.value
      revisions.profileUpdatedAt = profileAction.updatedAt
    }
    else if (profileAction.type === 'none') {
      revisions.profileUpdatedAt = profileUpdatedAt
    }

    const persisted = remoteSections(settings)
    const sections: AccountSections = { ...persisted, cardOverrides: [...(persisted.cardOverrides ?? [])] }
    for (const remoteCard of snapshot.cards) {
      if (remoteCard.deletedAt)
        continue
      const lifted = liftStoredCardOverride(remoteCard.cardId, remoteCard.card, iso(remoteCard.updatedAt))
      if (!lifted)
        continue
      const current = sections.cardOverrides?.find(item => item.cardId === lifted.cardId)
      if (!current) {
        sections.cardOverrides = [...(sections.cardOverrides ?? []), lifted]
        continue
      }
      if (!current.speech && lifted.speech)
        current.speech = lifted.speech
      if (!current.scene && lifted.scene)
        current.scene = lifted.scene
      if (!current.displayModel && lifted.displayModel)
        current.displayModel = lifted.displayModel
    }
    await applyRemoteSections(sections)
    // Local expression toggles may predate account sync or a failed upload.
    // Stamp them so schedulePush below actually sends modelExpressions.
    markUnsyncedLocalExpressions(persisted)
    saveRevisions(userId, revisions)
    rememberLocalSnapshot()
    pushEnabled = true
    importPromptOpen.value = false
    // The account row can exist while every settings block is still empty.
    // Upload the current model, scene, and the other blocks once.
    if (!hasAccountSections(persisted)) {
      try {
        await saveCurrentSections(userId)
      }
      catch (error) {
        console.error('[runtime-profile] settings save failed', error)
      }
    }

    schedulePush()
  }

  async function saveCurrentSections(userId: string) {
    const now = new Date().toISOString()
    revisions.activeCardUpdatedAt = now
    revisions.profileUpdatedAt = now
    revisions.modulesUpdatedAt = now
    revisions.knowledgeBaseUpdatedAt = now
    revisions.connectionUpdatedAt = now
    revisions.systemUpdatedAt = now
    revisions.modelViewUpdatedAt = now
    const override = readActiveCardOverride()
    const sections: AccountSections = {
      modules: { ...readModulesBody(), updatedAt: now },
      knowledgeBase: { ...readKnowledgeBaseBody(), updatedAt: now },
      connection: { ...readConnectionBody(), updatedAt: now },
      system: { ...readSystemBody(), updatedAt: now },
      modelView: { ...readModelViewBody(), updatedAt: now },
    }
    if (override) {
      revisions.cardSpeech[override.cardId] = now
      revisions.cardScene[override.cardId] = now
      const displayPayload = displayModelPayload(override)
      sections.cardOverrides = [{
        cardId: override.cardId,
        speech: { ...override.speech, updatedAt: now },
        scene: { backgroundId: override.scene.backgroundId, updatedAt: now },
        ...(displayPayload ? { displayModel: { ...displayPayload, updatedAt: now } } : {}),
      }]
      if (override.displayModelId)
        revisions.cardDisplayModel[override.cardId] = now
    }
    const scenes = await readSceneBodies()
    if (scenes.length > 0) {
      sections.scenes = scenes.map(scene => ({ ...scene, updatedAt: now }))
      for (const scene of scenes)
        revisions.scenes[scene.id] = now
    }
    const expressions = readModelExpressionBodies().filter(item => hasExpressionChoices(item))
    if (expressions.length > 0) {
      sections.modelExpressions = expressions.map(expression => ({
        ...expression,
        updatedAt: expression.updatedAt ?? now,
      }))
      for (const expression of expressions)
        revisions.modelExpressions[expression.modelId] = expression.updatedAt ?? now
    }
    await pushSettings(userId, sections)
    rememberLocalSnapshot()
    pushEnabled = true
  }

  function readProfileRevision(): { content: string, updatedAt: string | null } {
    return {
      content: readProfileContent(),
      updatedAt: revisions.profileUpdatedAt,
    }
  }

  /**
   * Copies a profile written by the memory rollup.
   *
   * The server already stored this text at `updatedAt`. The local revision
   * matches that time so the next settings save does not upload it again.
   */
  function applyRolledProfile(content: string, updatedAt: string) {
    applying = true
    profile.content = content
    lastProfile = content
    revisions.profileUpdatedAt = updatedAt
    const userId = currentUserId()
    if (userId)
      saveRevisions(userId, revisions)
    applying = false
  }

  async function acceptImport() {
    const userId = currentUserId()
    if (!userId)
      return

    importPending.value = true
    importError.value = null
    try {
      applying = true
      await saveCurrentSections(userId)
      importPromptOpen.value = false
      writeImportChoice(userId, 'saved')
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
      writeImportChoice(userId, 'dismissed')
    importPromptOpen.value = false
    importError.value = null
  }

  async function reconcile() {
    const userId = currentUserId()
    pushEnabled = false
    importPromptOpen.value = false
    if (!userId) {
      applying = false
      return
    }

    // Every signed-in tab loads the account copy. Pinia leadership is only
    // required later when this tab uploads a local edit. Waiting for the leader
    // before apply left follower tabs on their old model and scene forever.
    applying = true
    try {
      revisions = loadRevisions(userId)
      if (await configureAsDefaultsIfEmpty())
        await cards.persistActiveCardModuleSelections()
      await applySnapshot(userId)
    }
    catch (error) {
      console.error('[runtime-profile] load failed', error)
    }
    finally {
      applying = false
    }
  }

  /**
   * Pulls account expression choices without a full page reload.
   *
   * Chrome can upload while this tab stays open. Focus/visibility is enough to
   * notice the newer account copy and apply it.
   */
  async function pullRemoteExpressions() {
    const userId = currentUserId()
    if (!userId || !pushEnabled || applying)
      return

    try {
      applying = true
      const snapshot = await fetchRuntimeProfile()
      const settings = snapshot.settings?.deletedAt ? null : snapshot.settings
      if (!settings)
        return
      const sections = remoteSections(settings)
      await applyRemoteSections({
        modelExpressions: sections.modelExpressions,
        cardOverrides: sections.cardOverrides,
      })
      saveRevisions(userId, revisions)
      rememberLocalSnapshot()
      // Upload any local expression edits that still beat the account copy.
      schedulePush()
    }
    catch (error) {
      console.error('[runtime-profile] expression pull failed', error)
    }
    finally {
      applying = false
    }
  }

  function start(): Promise<void> {
    if (started)
      return startup
    started = true

    stopLeadershipWatch?.()
    stopLeadershipWatch = synced.onLeadershipChange((isLeader) => {
      // Local edits may have been recorded while this tab was a follower.
      if (isLeader && pushEnabled && currentUserId())
        schedulePush()
    })

    watch(() => auth.userId, () => {
      startup = reconcile()
    }, { immediate: true })

    watch(() => [
      readActiveCardId(),
      readProfileContent(),
      JSON.stringify(readModulesBody()),
      JSON.stringify(readKnowledgeBaseBody()),
      JSON.stringify(readConnectionBody()),
      JSON.stringify(readSystemBody()),
      JSON.stringify(readModelViewBody()),
      // Track the card fields directly. A stringified override object can miss
      // Map updates when Pinia replaces the card entry.
      cards.activeCardId,
      cards.activeCard?.extensions?.airi?.modules?.activeBackgroundId ?? '',
      cards.activeCard?.extensions?.airi?.modules?.displayModelId ?? '',
      JSON.stringify(readActiveCardOverride()),
      sceneSignature(),
      expressionStore.persistenceRevision,
      expressionSettingsSignature(),
    ], () => noteLocalEdits())

    const onVisible = () => {
      if (document.visibilityState === 'visible')
        void pullRemoteExpressions()
    }
    window.addEventListener('focus', onVisible)
    document.addEventListener('visibilitychange', onVisible)

    return startup
  }

  return {
    start,
    readProfileRevision,
    applyRolledProfile,
    importPromptOpen,
    importError,
    importPending,
    acceptImport,
    dismissImport,
  }
}
