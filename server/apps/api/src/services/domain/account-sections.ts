/** A client clock more than one hour ahead is stored as the server time. */
const FUTURE_SKEW_MS = 60 * 60 * 1000

export interface TimedSpeech {
  provider: string
  model: string
  voiceId: string
  pitch: number
  rate: number
  ssml: boolean
  updatedAt: string
}

export interface CardOverride {
  cardId: string
  speech?: TimedSpeech
  scene?: {
    backgroundId: string
    updatedAt: string
  }
  displayModel?: {
    modelId: string
    updatedAt: string
    llmMode?: 'all' | 'none' | 'custom'
    llmExposed?: Record<string, boolean>
    defaults?: Record<string, number>
    values?: Record<string, number>
    activeGroups?: Record<string, boolean>
  }
}

export interface SceneBackgroundRecord {
  id: string
  title: string
  mimeType: string
  data: string
  updatedAt: string
  deletedAt?: string
}

export interface ModulesSection {
  updatedAt: string
  consciousness: {
    provider: string
    model: string
    customModel: string
    reasoning: boolean
  }
  hearing: {
    provider: string
    model: string
    customModel: string
    autoSendEnabled: boolean
    autoSendDelay: number
    confidenceThreshold: number
  }
  vision: {
    provider: string
    model: string
    customModel: string
    ollamaThinkingEnabled: boolean
  }
  webSearch: {
    enabled: boolean
    apiKey: string
  }
  artistry: {
    provider: string
    model: string
    promptPrefix: string
    comfyuiServerUrl: string
    comfyuiActiveWorkflow: string
    replicateApiKey: string
    replicateDefaultModel: string
    replicateAspectRatio: string
    replicateInferenceSteps: number
    nanobananaApiKey: string
    nanobananaModel: string
    nanobananaResolution: string
  }
  discord: {
    enabled: boolean
    token: string
  }
  twitter: {
    enabled: boolean
    apiKey: string
    apiSecret: string
    accessToken: string
    accessTokenSecret: string
  }
  factorio: {
    enabled: boolean
    serverAddress: string
    serverPort: number | null
    username: string
  }
  mcp: {
    serverCmd: string
    serverArgs: string
  }
  beatSync: {
    spectrumScale: 'linear' | 'logarithm'
  }
}

export interface KnowledgeBaseSection {
  updatedAt: string
  connections: Array<{
    id: string
    name: string
    baseUrl: string
    apiKey: string
    knowledgeBaseId: string
    enabled: boolean
    /**
     * The chat flow the connection answers.
     *
     * Absent on rows written before the client sent a scope. The client reads a
     * missing value as `chat`, which is the flow that answered then.
     */
    scope?: KnowledgeBaseScope
  }>
}

/** The chat flows a knowledge base connection can answer. */
export type KnowledgeBaseScope = 'chat' | 'medical'

export interface ConnectionSection {
  updatedAt: string
  websocketUrl: string
  websocketSecure: boolean
}

export interface SystemSection {
  updatedAt: string
  language: string
  disableTransitions: boolean
  usePageSpecificTransitions: boolean
  themeColorsHue: number
  themeColorsHueDynamic: boolean
  analyticsEnabled: boolean
}

export interface ModelViewSection {
  updatedAt: string
  position: { x: number, y: number }
  scale: number
  currentMotion: { group: string, index?: number }
  modelParameters: {
    angleX: number
    angleY: number
    angleZ: number
    leftEyeOpen: number
    rightEyeOpen: number
    leftEyeSmile: number
    rightEyeSmile: number
    leftEyebrowLR: number
    rightEyebrowLR: number
    leftEyebrowY: number
    rightEyebrowY: number
    leftEyebrowAngle: number
    rightEyebrowAngle: number
    leftEyebrowForm: number
    rightEyebrowForm: number
    mouthOpen: number
    mouthForm: number
    cheek: number
    bodyAngleX: number
    bodyAngleY: number
    bodyAngleZ: number
    breath: number
  }
  eyeTracking: boolean
  eyeOffset: { x: number, y: number }
  idleAnimation: boolean
  idleEyeAnimation: boolean
  autoBlink: boolean
  forceAutoBlink: boolean
  expression: boolean
  shadow: boolean
  maxFps: number
  renderScale: number
  motionDriver: 'magic' | 'universal'
  spinePremultipliedAlpha: boolean
  spineDefaultMix: number
  spineIdleEnabled: boolean
  spineMaxFps: number
  spineRenderScale: number
}

/** Expression-system choices for one display model. */
export interface ModelExpressionRecord {
  modelId: string
  updatedAt: string
  llmMode: 'all' | 'none' | 'custom'
  llmExposed: Record<string, boolean>
  defaults: Record<string, number>
  values: Record<string, number>
  activeGroups?: Record<string, boolean>
}

/**
 * Settings that follow the signed-in account.
 *
 * Each block keeps its own save time. A newer voice does not replace a newer
 * theme. Card voice, scene, and display model keep a save time per card.
 */
export interface AccountSections {
  modules?: ModulesSection
  knowledgeBase?: KnowledgeBaseSection
  connection?: ConnectionSection
  system?: SystemSection
  modelView?: ModelViewSection
  cardOverrides?: CardOverride[]
  scenes?: SceneBackgroundRecord[]
  modelExpressions?: ModelExpressionRecord[]
}

function clampIso(value: string, now: Date): string {
  const incoming = new Date(value)
  if (!Number.isFinite(incoming.getTime()))
    return now.toISOString()
  if (incoming.getTime() > now.getTime() + FUTURE_SKEW_MS)
    return now.toISOString()
  return incoming.toISOString()
}

function isCurrentOrNewer(incomingIso: string, storedIso: string): boolean {
  return new Date(incomingIso).getTime() >= new Date(storedIso).getTime()
}

function mergeTimed<T extends { updatedAt: string }>(stored: T | undefined, incoming: T | undefined, now: Date): T | undefined {
  if (!incoming)
    return stored

  const stamped = { ...incoming, updatedAt: clampIso(incoming.updatedAt, now) }
  if (!stored || isCurrentOrNewer(stamped.updatedAt, stored.updatedAt))
    return stamped
  return stored
}

function mergeCardOverrides(stored: CardOverride[] | undefined, incoming: CardOverride[] | undefined, now: Date): CardOverride[] | undefined {
  if (!incoming)
    return stored

  const byId = new Map((stored ?? []).map(item => [item.cardId, item]))
  for (const item of incoming) {
    const previous = byId.get(item.cardId)
    byId.set(item.cardId, {
      cardId: item.cardId,
      speech: mergeTimed(previous?.speech, item.speech, now),
      scene: mergeTimed(previous?.scene, item.scene, now),
      displayModel: mergeTimed(previous?.displayModel, item.displayModel, now),
    })
  }
  return [...byId.values()]
}

function mergeScenes(stored: SceneBackgroundRecord[] | undefined, incoming: SceneBackgroundRecord[] | undefined, now: Date): SceneBackgroundRecord[] | undefined {
  if (!incoming)
    return stored

  const byId = new Map((stored ?? []).map(item => [item.id, item]))
  for (const item of incoming) {
    const stamped: SceneBackgroundRecord = {
      ...item,
      updatedAt: clampIso(item.updatedAt, now),
      ...(item.deletedAt ? { deletedAt: clampIso(item.deletedAt, now) } : {}),
    }
    const previous = byId.get(item.id)
    if (previous && !isCurrentOrNewer(stamped.updatedAt, previous.updatedAt))
      continue
    if (stamped.deletedAt)
      stamped.data = ''
    byId.set(item.id, stamped)
  }
  return [...byId.values()]
}

function expressionRecordHasChoices(record: ModelExpressionRecord): boolean {
  if (record.llmMode !== 'none')
    return true
  if (Object.values(record.llmExposed).some(Boolean))
    return true
  if (Object.values(record.activeGroups ?? {}).some(Boolean))
    return true
  for (const [name, value] of Object.entries(record.values)) {
    const fallback = record.defaults[name] ?? 0
    if (Math.abs(value - fallback) > 1e-4)
      return true
  }
  return false
}

function mergeModelExpressions(
  stored: ModelExpressionRecord[] | undefined,
  incoming: ModelExpressionRecord[] | undefined,
  now: Date,
): ModelExpressionRecord[] | undefined {
  if (!incoming)
    return stored

  const byId = new Map((stored ?? []).map(item => [item.modelId, item]))
  for (const item of incoming) {
    const stamped: ModelExpressionRecord = {
      ...item,
      updatedAt: clampIso(item.updatedAt, now),
    }
    const previous = byId.get(item.modelId)
    if (previous && !isCurrentOrNewer(stamped.updatedAt, previous.updatedAt))
      continue
    // An empty checkbox dump must not erase a newer meaningful account copy
    // when a second browser mints a slightly later idle timestamp.
    if (previous && expressionRecordHasChoices(previous) && !expressionRecordHasChoices(stamped))
      continue
    byId.set(item.modelId, stamped)
  }
  return [...byId.values()]
}

/**
 * Keeps the newer copy of each settings block.
 *
 * A block missing from the incoming save stays as stored. An older save of one
 * block leaves the newer stored block in place.
 */
export function mergeAccountSections(stored: AccountSections | null | undefined, incoming: AccountSections | undefined, now: Date): AccountSections {
  const current = stored ?? {}
  if (!incoming)
    return current

  return {
    modules: mergeTimed(current.modules, incoming.modules, now),
    knowledgeBase: mergeTimed(current.knowledgeBase, incoming.knowledgeBase, now),
    connection: mergeTimed(current.connection, incoming.connection, now),
    system: mergeTimed(current.system, incoming.system, now),
    modelView: mergeTimed(current.modelView, incoming.modelView, now),
    cardOverrides: mergeCardOverrides(current.cardOverrides, incoming.cardOverrides, now),
    scenes: mergeScenes(current.scenes, incoming.scenes, now),
    modelExpressions: mergeModelExpressions(current.modelExpressions, incoming.modelExpressions, now),
  }
}

/** True when the account has at least one saved settings block. */
export function hasAccountSections(sections: AccountSections | null | undefined): boolean {
  if (!sections)
    return false
  return Boolean(
    sections.modules
    || sections.knowledgeBase
    || sections.connection
    || sections.system
    || sections.modelView
    || sections.cardOverrides?.length
    || sections.scenes?.length
    || sections.modelExpressions?.length,
  )
}
