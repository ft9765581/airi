import type { AccountSections } from './account-settings'

import {
  defaultModelParameters,
  listPersistedExpressionSettings,
  loadPersistedExpressionSettings,
  useExpressionStore,
  useLive2dParams,
  useSettingsLive2d,
} from '@proj-airi/stage-ui-live2d'

import { useBackgroundStore } from '../stores/background'
import { useMcpStore } from '../stores/mcp'
import { useModsServerChannelStore } from '../stores/mods/api/channel-server'
import { useAiriCardStore } from '../stores/modules/airi-card'
import { useArtistryStore } from '../stores/modules/artistry'
import { useConsciousnessStore } from '../stores/modules/consciousness'
import { useConsciousnessSettingsStore } from '../stores/modules/consciousness-settings'
import { useDiscordStore } from '../stores/modules/discord'
import { useFactorioStore } from '../stores/modules/gaming-factorio'
import { useHearingStore } from '../stores/modules/hearing'
import { useSpeechStore } from '../stores/modules/speech'
import { useTwitterStore } from '../stores/modules/twitter'
import { useVisionStore } from '../stores/modules/vision/store'
import { useWebSearchStore } from '../stores/modules/web-search'
import { useSettingsAnalytics } from '../stores/settings/analytics'
import { useSettingsBeatSync } from '../stores/settings/beat-sync'
import { useSettingsGeneral } from '../stores/settings/general'
import { useSettingsKnowledgeBase } from '../stores/settings/knowledge-base'
import { useSettingsSpine } from '../stores/settings/spine'
import { useSettingsTheme } from '../stores/settings/theme'
import { useSettingsUserProfile } from '../stores/settings/user-profile'

/** One custom scene image stays under the API body limit. */
export const MAX_SCENE_DATA_CHARS = 600_000

type ModulesBody = AccountSections['modules']
type KnowledgeBody = AccountSections['knowledgeBase']
type ConnectionBody = AccountSections['connection']
type SystemBody = AccountSections['system']
type ModelViewBody = AccountSections['modelView']

function clip(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value
}

function withoutTime<T extends { updatedAt: string }>(section: T): Omit<T, 'updatedAt'> {
  const { updatedAt: _updatedAt, ...body } = section
  return body
}

/** Reads the module choices that follow the account. */
export function readModulesBody(): Omit<NonNullable<ModulesBody>, 'updatedAt'> {
  const consciousness = useConsciousnessStore()
  const consciousnessSettings = useConsciousnessSettingsStore()
  const hearing = useHearingStore()
  const vision = useVisionStore()
  const webSearch = useWebSearchStore()
  const artistry = useArtistryStore()
  const discord = useDiscordStore()
  const twitter = useTwitterStore()
  const factorio = useFactorioStore()
  const mcp = useMcpStore()
  const beatSync = useSettingsBeatSync()

  return {
    consciousness: {
      provider: consciousness.activeProvider,
      model: consciousness.activeModel,
      customModel: consciousness.customModelName,
      reasoning: consciousnessSettings.reasoning,
    },
    hearing: {
      provider: hearing.activeTranscriptionProvider,
      model: hearing.activeTranscriptionModel,
      customModel: hearing.activeCustomModelName,
      autoSendEnabled: hearing.autoSendEnabled,
      autoSendDelay: hearing.autoSendDelay,
      confidenceThreshold: hearing.confidenceThreshold,
    },
    vision: {
      provider: vision.activeProvider,
      model: vision.activeModel,
      customModel: vision.customModelName,
      ollamaThinkingEnabled: vision.ollamaThinkingEnabled,
    },
    webSearch: {
      enabled: webSearch.enabled,
      apiKey: clip(webSearch.apiKey, 4_096),
    },
    artistry: {
      provider: artistry.globalProvider,
      model: artistry.globalModel,
      promptPrefix: clip(artistry.globalPromptPrefix, 4_000),
      comfyuiServerUrl: clip(artistry.comfyuiServerUrl, 2_000),
      comfyuiActiveWorkflow: artistry.comfyuiActiveWorkflow,
      replicateApiKey: clip(artistry.replicateApiKey, 4_096),
      replicateDefaultModel: artistry.replicateDefaultModel,
      replicateAspectRatio: artistry.replicateAspectRatio,
      replicateInferenceSteps: artistry.replicateInferenceSteps,
      nanobananaApiKey: clip(artistry.nanobananaApiKey, 4_096),
      nanobananaModel: artistry.nanobananaModel,
      nanobananaResolution: artistry.nanobananaResolution,
    },
    discord: {
      enabled: discord.enabled,
      token: clip(discord.token, 4_096),
    },
    twitter: {
      enabled: twitter.enabled,
      apiKey: clip(twitter.apiKey, 4_096),
      apiSecret: clip(twitter.apiSecret, 4_096),
      accessToken: clip(twitter.accessToken, 4_096),
      accessTokenSecret: clip(twitter.accessTokenSecret, 4_096),
    },
    factorio: {
      enabled: factorio.enabled,
      serverAddress: clip(factorio.serverAddress, 2_000),
      serverPort: factorio.serverPort,
      username: factorio.username,
    },
    mcp: {
      serverCmd: clip(mcp.serverCmd, 1_024),
      serverArgs: clip(mcp.serverArgs, 4_096),
    },
    beatSync: {
      spectrumScale: beatSync.spectrumScale,
    },
  }
}

/** Reads knowledge-base connections. */
export function readKnowledgeBaseBody(): Omit<NonNullable<KnowledgeBody>, 'updatedAt'> {
  return {
    connections: useSettingsKnowledgeBase().connections.slice(0, 20).map(connection => ({
      id: clip(connection.id, 64),
      name: clip(connection.name, 200),
      baseUrl: clip(connection.baseUrl, 2_000),
      apiKey: clip(connection.apiKey, 4_096),
      knowledgeBaseId: clip(connection.knowledgeBaseId, 256),
      enabled: connection.enabled,
    })),
  }
}

/** Reads the connection page. */
export function readConnectionBody(): Omit<NonNullable<ConnectionBody>, 'updatedAt'> {
  return {
    websocketUrl: clip(useModsServerChannelStore().websocketUrl, 2_000),
    websocketSecure: useSettingsGeneral().websocketSecureEnabled,
  }
}

/** Reads language, theme, and related system choices. */
export function readSystemBody(): Omit<NonNullable<SystemBody>, 'updatedAt'> {
  const general = useSettingsGeneral()
  const theme = useSettingsTheme()
  return {
    language: clip(general.language, 32),
    disableTransitions: general.disableTransitions,
    usePageSpecificTransitions: general.usePageSpecificTransitions,
    themeColorsHue: theme.themeColorsHue,
    themeColorsHueDynamic: theme.themeColorsHueDynamic,
    analyticsEnabled: useSettingsAnalytics().analyticsEnabled,
  }
}

/** Reads character-model adjustments. The model file stays on this device. */
export function readModelViewBody(): Omit<NonNullable<ModelViewBody>, 'updatedAt'> {
  const live2d = useLive2dParams()
  const live2dSettings = useSettingsLive2d()
  const spine = useSettingsSpine()
  const parameters = { ...defaultModelParameters, ...live2d.modelParameters }

  return {
    position: { x: live2d.position.x, y: live2d.position.y },
    scale: live2d.scale,
    currentMotion: {
      group: live2d.currentMotion.group,
      ...(live2d.currentMotion.index !== undefined ? { index: live2d.currentMotion.index } : {}),
    },
    modelParameters: parameters,
    eyeTracking: live2dSettings.live2dEyeTracking,
    eyeOffset: { x: live2dSettings.live2dModelEyeOffset.x, y: live2dSettings.live2dModelEyeOffset.y },
    idleAnimation: live2dSettings.live2dIdleAnimationEnabled,
    idleEyeAnimation: live2dSettings.live2dForceIdleEyeAnimation,
    autoBlink: live2dSettings.live2dAutoBlinkEnabled,
    forceAutoBlink: live2dSettings.live2dForceAutoBlinkEnabled,
    expression: live2dSettings.live2dExpressionEnabled,
    shadow: live2dSettings.live2dShadowEnabled,
    maxFps: live2dSettings.live2dMaxFps,
    renderScale: live2dSettings.live2dRenderScale,
    motionDriver: live2dSettings.live2dMotionDriver,
    spinePremultipliedAlpha: spine.spinePremultipliedAlpha,
    spineDefaultMix: spine.spineDefaultMixDuration,
    spineIdleEnabled: spine.spineIdleAnimationEnabled,
    spineMaxFps: spine.spineMaxFps,
    spineRenderScale: spine.spineRenderScale,
  }
}

/** Reads the voice, scene, and display model on the selected character card. */
export function readActiveCardOverride(): {
  cardId: string
  speech: Omit<NonNullable<NonNullable<AccountSections['cardOverrides']>[number]['speech']>, 'updatedAt'>
  scene: { backgroundId: string }
  displayModelId?: string
  displayModelExpressions?: {
    llmMode: 'all' | 'none' | 'custom'
    llmExposed: Record<string, boolean>
    defaults: Record<string, number>
    values: Record<string, number>
    activeGroups: Record<string, boolean>
  }
} | null {
  const cards = useAiriCardStore()
  const card = cards.activeCard
  if (!card)
    return null

  const speech = useSpeechStore()
  const modules = card.extensions?.airi?.modules
  const displayModelId = modules?.displayModelId
  const displayModelExpressions = displayModelId
    ? loadPersistedExpressionSettings(displayModelId)
    : undefined
  return {
    cardId: cards.activeCardId,
    speech: {
      provider: speech.activeSpeechProvider,
      model: speech.activeSpeechModel,
      voiceId: speech.activeSpeechVoiceId,
      pitch: speech.pitch,
      rate: speech.rate,
      ssml: speech.ssmlEnabled,
    },
    scene: {
      backgroundId: modules?.activeBackgroundId || 'none',
    },
    ...(displayModelId ? { displayModelId } : {}),
    ...(displayModelExpressions ? { displayModelExpressions } : {}),
  }
}

export function readProfileContent(): string {
  return clip(useSettingsUserProfile().content, 20_000)
}

export function readActiveCardId(): string {
  return useAiriCardStore().activeCardId
}

/** Writes one settings block into the local stores. */
export async function applyModules(section: NonNullable<ModulesBody>) {
  const body = withoutTime(section)
  const consciousness = useConsciousnessStore()
  consciousness.activeProvider = body.consciousness.provider
  consciousness.activeModel = body.consciousness.model
  consciousness.customModelName = body.consciousness.customModel
  await useConsciousnessSettingsStore().setReasoning(body.consciousness.reasoning)

  const hearing = useHearingStore()
  hearing.activeTranscriptionProvider = body.hearing.provider
  hearing.activeTranscriptionModel = body.hearing.model
  hearing.activeCustomModelName = body.hearing.customModel
  hearing.autoSendEnabled = body.hearing.autoSendEnabled
  hearing.autoSendDelay = body.hearing.autoSendDelay
  hearing.confidenceThreshold = body.hearing.confidenceThreshold

  const vision = useVisionStore()
  vision.activeProvider = body.vision.provider
  vision.activeModel = body.vision.model
  vision.customModelName = body.vision.customModel
  vision.ollamaThinkingEnabled = body.vision.ollamaThinkingEnabled

  const webSearch = useWebSearchStore()
  webSearch.enabled = body.webSearch.enabled
  webSearch.apiKey = body.webSearch.apiKey

  const artistry = useArtistryStore()
  artistry.globalProvider = body.artistry.provider
  artistry.globalModel = body.artistry.model
  artistry.globalPromptPrefix = body.artistry.promptPrefix
  artistry.comfyuiServerUrl = body.artistry.comfyuiServerUrl
  artistry.comfyuiActiveWorkflow = body.artistry.comfyuiActiveWorkflow
  artistry.replicateApiKey = body.artistry.replicateApiKey
  artistry.replicateDefaultModel = body.artistry.replicateDefaultModel
  artistry.replicateAspectRatio = body.artistry.replicateAspectRatio
  artistry.replicateInferenceSteps = body.artistry.replicateInferenceSteps
  artistry.nanobananaApiKey = body.artistry.nanobananaApiKey
  artistry.nanobananaModel = body.artistry.nanobananaModel
  artistry.nanobananaResolution = body.artistry.nanobananaResolution

  const discord = useDiscordStore()
  discord.enabled = body.discord.enabled
  discord.token = body.discord.token
  discord.saveSettings()

  const twitter = useTwitterStore()
  twitter.enabled = body.twitter.enabled
  twitter.apiKey = body.twitter.apiKey
  twitter.apiSecret = body.twitter.apiSecret
  twitter.accessToken = body.twitter.accessToken
  twitter.accessTokenSecret = body.twitter.accessTokenSecret
  twitter.saveSettings()

  const factorio = useFactorioStore()
  factorio.enabled = body.factorio.enabled
  factorio.serverAddress = body.factorio.serverAddress
  factorio.serverPort = body.factorio.serverPort
  factorio.username = body.factorio.username
  factorio.saveSettings()

  const mcp = useMcpStore()
  mcp.serverCmd = body.mcp.serverCmd
  mcp.serverArgs = body.mcp.serverArgs

  useSettingsBeatSync().spectrumScale = body.beatSync.spectrumScale
}

export function applyKnowledgeBase(section: NonNullable<KnowledgeBody>) {
  useSettingsKnowledgeBase().connections = section.connections.map(connection => ({ ...connection }))
}

export function applyConnection(section: NonNullable<ConnectionBody>) {
  useModsServerChannelStore().websocketUrl = section.websocketUrl
  useSettingsGeneral().websocketSecureEnabled = section.websocketSecure
}

export function applySystem(section: NonNullable<SystemBody>) {
  const general = useSettingsGeneral()
  general.language = section.language
  general.disableTransitions = section.disableTransitions
  general.usePageSpecificTransitions = section.usePageSpecificTransitions
  const theme = useSettingsTheme()
  theme.themeColorsHue = section.themeColorsHue
  theme.themeColorsHueDynamic = section.themeColorsHueDynamic
  useSettingsAnalytics().analyticsEnabled = section.analyticsEnabled
}

export function applyModelView(section: NonNullable<ModelViewBody>) {
  const live2d = useLive2dParams()
  live2d.position = { ...section.position }
  live2d.scale = section.scale
  live2d.currentMotion = { ...section.currentMotion }
  live2d.modelParameters = { ...defaultModelParameters, ...section.modelParameters }
  live2d.shouldUpdateView()

  const settings = useSettingsLive2d()
  settings.live2dEyeTracking = section.eyeTracking
  settings.live2dModelEyeOffset = { ...section.eyeOffset }
  settings.live2dIdleAnimationEnabled = section.idleAnimation
  settings.live2dForceIdleEyeAnimation = section.idleEyeAnimation
  settings.live2dAutoBlinkEnabled = section.autoBlink
  settings.live2dForceAutoBlinkEnabled = section.forceAutoBlink
  settings.live2dExpressionEnabled = section.expression
  settings.live2dShadowEnabled = section.shadow
  settings.live2dMaxFps = section.maxFps
  settings.live2dRenderScale = section.renderScale
  settings.live2dMotionDriver = section.motionDriver

  const spine = useSettingsSpine()
  spine.spinePremultipliedAlpha = section.spinePremultipliedAlpha
  spine.spineDefaultMixDuration = section.spineDefaultMix
  spine.spineIdleAnimationEnabled = section.spineIdleEnabled
  spine.spineMaxFps = section.spineMaxFps
  spine.spineRenderScale = section.spineRenderScale
}

/**
 * Writes the saved voice, scene, and display model onto that character card.
 *
 * @returns `false` when that card is not on this browser, so the caller can try again.
 */
export async function applyCardOverride(override: NonNullable<AccountSections['cardOverrides']>[number]): Promise<boolean> {
  const cards = useAiriCardStore()
  const card = cards.cards.get(override.cardId)
  if (!card)
    return false

  const extension = JSON.parse(JSON.stringify(card.extensions)) as typeof card.extensions
  if (!extension.airi.modules)
    extension.airi.modules = card.extensions.airi.modules

  if (override.speech) {
    extension.airi.modules.speech = {
      ...extension.airi.modules.speech,
      provider: override.speech.provider,
      model: override.speech.model,
      voice_id: override.speech.voiceId,
      pitch: override.speech.pitch,
      rate: override.speech.rate,
      ssml: override.speech.ssml,
    }
  }
  if (override.scene)
    extension.airi.modules.activeBackgroundId = override.scene.backgroundId
  if (override.displayModel) {
    extension.airi.modules.displayModelId = override.displayModel.modelId
    if (override.displayModel.llmMode != null
      || override.displayModel.llmExposed
      || override.displayModel.defaults
      || override.displayModel.values
      || override.displayModel.activeGroups) {
      useExpressionStore().applyAccountSettings(override.displayModel.modelId, {
        llmMode: override.displayModel.llmMode ?? 'none',
        llmExposed: override.displayModel.llmExposed ?? {},
        defaults: override.displayModel.defaults ?? {},
        values: override.displayModel.values ?? {},
        activeGroups: override.displayModel.activeGroups ?? {},
        updatedAt: override.displayModel.updatedAt,
      })
    }
  }

  const wrote = await cards.updateCard(override.cardId, { ...card, extensions: extension })

  if (override.cardId === cards.activeCardId && override.speech) {
    const speech = useSpeechStore()
    speech.pitch = override.speech.pitch
    speech.rate = override.speech.rate
    speech.ssmlEnabled = override.speech.ssml
  }

  return wrote
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const step = 0x8000
  for (let index = 0; index < bytes.length; index += step)
    binary += String.fromCharCode(...bytes.subarray(index, index + step))
  return btoa(binary)
}

function base64ToBlob(data: string, mimeType: string): Blob {
  const binary = atob(data)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1)
    bytes[index] = binary.charCodeAt(index)
  return new Blob([bytes], { type: mimeType })
}

/** Reads custom scene images that fit in one account save. */
export async function readSceneBodies(): Promise<Array<Omit<NonNullable<AccountSections['scenes']>[number], 'updatedAt'>>> {
  const backgrounds = useBackgroundStore()
  const scenes = [...backgrounds.entries.values()].filter(entry => entry.type === 'scene')
  const selectedId = useAiriCardStore().activeCard?.extensions?.airi?.modules?.activeBackgroundId
  const ordered = [...scenes].sort((left, right) => {
    if (left.id === selectedId)
      return -1
    if (right.id === selectedId)
      return 1
    return right.createdAt - left.createdAt
  })

  const result: Array<Omit<NonNullable<AccountSections['scenes']>[number], 'updatedAt'>> = []
  let used = 0
  for (const entry of ordered) {
    if (result.length >= 4)
      break
    const data = bytesToBase64(new Uint8Array(await entry.blob.arrayBuffer()))
    if (data.length > MAX_SCENE_DATA_CHARS || used + data.length > MAX_SCENE_DATA_CHARS)
      continue
    used += data.length
    result.push({
      id: entry.id,
      title: entry.title,
      mimeType: entry.blob.type || 'application/octet-stream',
      data,
    })
  }
  return result
}

/** Writes account scene images into the local background store. */
export async function applyScenes(scenes: NonNullable<AccountSections['scenes']>) {
  const backgrounds = useBackgroundStore()
  for (const scene of scenes) {
    if (scene.deletedAt) {
      if (backgrounds.entries.has(scene.id))
        await backgrounds.removeBackground(scene.id)
      continue
    }
    if (!scene.data)
      continue
    await backgrounds.importBackground({
      id: scene.id,
      type: 'scene',
      characterId: null,
      title: scene.title,
      blob: base64ToBlob(scene.data, scene.mimeType),
      createdAt: Date.parse(scene.updatedAt) || Date.now(),
    })
  }
}

function clipNumberRecord(record: Record<string, number>, maxEntries: number): Record<string, number> {
  const next: Record<string, number> = {}
  for (const [key, value] of Object.entries(record).slice(0, maxEntries)) {
    if (typeof value === 'number' && Number.isFinite(value))
      next[clip(key, 128)] = value
  }
  return next
}

function clipBooleanRecord(record: Record<string, boolean>, maxEntries: number): Record<string, boolean> {
  const next: Record<string, boolean> = {}
  for (const [key, value] of Object.entries(record).slice(0, maxEntries)) {
    if (typeof value === 'boolean')
      next[clip(key, 64)] = value
  }
  return next
}

/** Reads expression-system choices for every display model adjusted on this browser. */
export function readModelExpressionBodies(): Array<Omit<NonNullable<AccountSections['modelExpressions']>[number], 'updatedAt'> & { updatedAt?: string }> {
  return listPersistedExpressionSettings().slice(0, 32).map(item => ({
    modelId: clip(item.modelId, 256),
    llmMode: item.llmMode,
    llmExposed: clipBooleanRecord(item.llmExposed, 64),
    defaults: clipNumberRecord(item.defaults, 128),
    values: clipNumberRecord(item.values, 128),
    activeGroups: clipBooleanRecord(item.activeGroups, 64),
    ...(item.updatedAt ? { updatedAt: item.updatedAt } : {}),
  }))
}

/** Writes account expression-system choices into local storage and the live store. */
export function applyModelExpressions(expressions: NonNullable<AccountSections['modelExpressions']>) {
  const store = useExpressionStore()
  for (const item of expressions) {
    store.applyAccountSettings(item.modelId, {
      llmMode: item.llmMode,
      llmExposed: item.llmExposed,
      defaults: item.defaults,
      values: item.values,
      activeGroups: item.activeGroups ?? {},
      updatedAt: item.updatedAt,
    })
  }
}
