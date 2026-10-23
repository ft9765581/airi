/**
 * Settings that follow the signed-in account.
 *
 * Each block has its own save time. The voice, scene, and display model are
 * saved on the selected character card, not as a separate global voice.
 */
export interface AccountSections {
  modules?: {
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
    webSearch: { enabled: boolean, apiKey: string }
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
    discord: { enabled: boolean, token: string }
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
    mcp: { serverCmd: string, serverArgs: string }
    beatSync: { spectrumScale: 'linear' | 'logarithm' }
  }
  knowledgeBase?: {
    updatedAt: string
    connections: Array<{
      id: string
      name: string
      baseUrl: string
      apiKey: string
      knowledgeBaseId: string
      enabled: boolean
    }>
  }
  connection?: {
    updatedAt: string
    websocketUrl: string
    websocketSecure: boolean
  }
  system?: {
    updatedAt: string
    language: string
    disableTransitions: boolean
    usePageSpecificTransitions: boolean
    themeColorsHue: number
    themeColorsHueDynamic: boolean
    analyticsEnabled: boolean
  }
  modelView?: {
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
  cardOverrides?: Array<{
    cardId: string
    speech?: {
      provider: string
      model: string
      voiceId: string
      pitch: number
      rate: number
      ssml: boolean
      updatedAt: string
    }
    scene?: { backgroundId: string, updatedAt: string }
    displayModel?: {
      modelId: string
      updatedAt: string
      /** Expression-system choices for this display model. */
      llmMode?: 'all' | 'none' | 'custom'
      llmExposed?: Record<string, boolean>
      defaults?: Record<string, number>
      values?: Record<string, number>
      activeGroups?: Record<string, boolean>
    }
  }>
  scenes?: Array<{
    id: string
    title: string
    mimeType: string
    data: string
    updatedAt: string
    deletedAt?: string
  }>
  /**
   * Expression-system choices for each display model this account has adjusted.
   * Keyed by display model id so a second browser restores the same toggles.
   */
  modelExpressions?: Array<{
    modelId: string
    updatedAt: string
    llmMode: 'all' | 'none' | 'custom'
    llmExposed: Record<string, boolean>
    defaults: Record<string, number>
    values: Record<string, number>
    activeGroups: Record<string, boolean>
  }>
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

interface StoredCardModules {
  speech?: {
    provider?: unknown
    model?: unknown
    voice_id?: unknown
    pitch?: unknown
    rate?: unknown
    ssml?: unknown
  }
  activeBackgroundId?: unknown
  displayModelId?: unknown
}

function storedModules(card: unknown): StoredCardModules | null {
  if (card == null || typeof card !== 'object')
    return null
  const extensions = (card as { extensions?: { airi?: { modules?: StoredCardModules } } }).extensions
  return extensions?.airi?.modules ?? null
}

/**
 * Reads the voice, scene, and display model from a previously stored card.
 *
 * The account no longer keeps the whole card. This keeps the choices that
 * were saved inside that card until a settings block replaces them.
 */
export function liftStoredCardOverride(cardId: string, card: unknown, updatedAt: string): NonNullable<AccountSections['cardOverrides']>[number] | null {
  const modules = storedModules(card)
  if (!modules)
    return null

  const speech = modules.speech
  const provider = typeof speech?.provider === 'string' ? speech.provider : ''
  const model = typeof speech?.model === 'string' ? speech.model : ''
  const voiceId = typeof speech?.voice_id === 'string' ? speech.voice_id : ''
  const hasSpeech = provider.length > 0 || voiceId.length > 0
  const backgroundId = typeof modules.activeBackgroundId === 'string' ? modules.activeBackgroundId : ''
  const modelId = typeof modules.displayModelId === 'string' ? modules.displayModelId : ''
  if (!hasSpeech && !backgroundId && !modelId)
    return null

  return {
    cardId,
    ...(hasSpeech
      ? {
          speech: {
            provider,
            model,
            voiceId,
            pitch: typeof speech?.pitch === 'number' ? speech.pitch : 0,
            rate: typeof speech?.rate === 'number' ? speech.rate : 1,
            ssml: speech?.ssml === true,
            updatedAt,
          },
        }
      : {}),
    ...(backgroundId ? { scene: { backgroundId, updatedAt } } : {}),
    ...(modelId ? { displayModel: { modelId, updatedAt } } : {}),
  }
}
