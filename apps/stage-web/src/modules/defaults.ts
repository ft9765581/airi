/**
 * Applies the provider, module, and character defaults that this build carries.
 *
 * A deployed build serves one product with one backend. A new visitor must not
 * configure a provider by hand, so the build writes those choices into storage
 * before any store reads it.
 *
 * The function never replaces a value that the user chose, with one exception:
 * the display model belongs to the deployment, because a browser that keeps an
 * older model would not show the product character. The provider, model, and
 * voice of each module become the visitor's choice once they are set, and the
 * settings page offers a restore action that returns them to these defaults.
 *
 * Values come from the environment at build time. The API key of a paid cloud
 * provider must not arrive this way: it would ship inside the JavaScript bundle
 * and every visitor can read it. Point such a provider at a server that holds
 * the key instead.
 */

import {
  CONSCIOUSNESS_MODEL_KEY,
  CONSCIOUSNESS_PROVIDER_KEY,
  SPEECH_MODEL_KEY,
  SPEECH_PROVIDER_KEY,
  SPEECH_VOICE_KEY,
} from '@proj-airi/stage-ui/libs/deployment-default-keys'

import xiaoqingCard from '../assets/airi-cards/xiaoqing.json'

/** Id of the character card that this build ships. */
const DEFAULT_CARD_ID = 'xiaoqing'

/** Marks the defaults version that a browser already applied. */
const APPLIED_VERSION_KEY = 'settings/defaults/version'

/** Marks the provider purge value that a browser already applied. */
const PROVIDER_PURGE_KEY = 'settings/defaults/provider-purge'

const PROVIDERS_KEY = 'settings/providers/configured'
const ADDED_PROVIDERS_KEY = 'settings/providers/added'

/** Character card ids that an earlier build already offered to this browser. */
const SEEDED_CARDS_KEY = 'settings/defaults/seeded-cards'

const CARDS_KEY = 'airi-cards'
const ACTIVE_CARD_KEY = 'airi-card-active-id'

/** Active card ids that mean "the user has not picked a character yet". */
const UNCHOSEN_CARD_IDS = ['', 'default']

const STAGE_MODEL_KEY = 'settings/stage/model'
const USER_PROFILE_KEY = 'settings/user-profile/content'
const LIVE2D_SCALE_KEY = 'settings/live2d/scale'
const LIVE2D_POSITION_KEY = 'settings/live2d/position'

/**
 * The person that this product talks to.
 *
 * Product copy, not environment configuration, so it lives here. The profile is
 * author-owned data: the build writes it only while the user has not written
 * one, and the user can edit or clear it on the settings page.
 *
 * An empty string ships no profile: the visitor describes themselves.
 */
const DEFAULT_USER_PROFILE = ''

/**
 * How the character stands on the stage.
 *
 * Product look, so it lives here. `scale` is a factor of the fitted model, and
 * `y` moves the model in percent of the viewport height, upward.
 */
const DEFAULT_LIVE2D_SCALE = 0.75
const DEFAULT_LIVE2D_POSITION_Y = 20

/**
 * Values that an earlier build of this deployment wrote for the stage position.
 *
 * A later build may correct a value that it wrote itself, so these stay
 * replaceable. Any other value is a user choice, and this module keeps it. The
 * current default belongs in both lists.
 */
const SHIPPED_LIVE2D_SCALES = [1, 0.75]
const SHIPPED_LIVE2D_POSITION_YS = [0, 10, 20, 30]

/**
 * Values the application writes before the user chooses anything.
 *
 * A key that holds one of these values is still free to change. Any other value
 * is a user choice, and this module keeps it.
 */
const UNCHOSEN_VALUES: Record<string, readonly string[]> = {
  [CONSCIOUSNESS_PROVIDER_KEY]: [''],
  [CONSCIOUSNESS_MODEL_KEY]: [''],
  [SPEECH_PROVIDER_KEY]: ['', 'speech-noop'],
  [SPEECH_MODEL_KEY]: [''],
  [SPEECH_VOICE_KEY]: [''],
  [STAGE_MODEL_KEY]: ['', 'preset-live2d-1'],
  [USER_PROFILE_KEY]: [''],
}

/**
 * Values that an earlier build of this deployment wrote into keys that the user
 * owns.
 *
 * A later build must be able to correct a value that it wrote itself. Without
 * this list, that value looks like a user choice, and the correction never
 * reaches a browser that ran the earlier build.
 */
const SHIPPED_VALUES: Record<string, readonly string[]> = {
  // The profile that the first builds of this deployment shipped.
  [USER_PROFILE_KEY]: [
    '称呼：小雅\n产后三周，顺产，男孩\n青霉素过敏\n主要困扰：涨奶、夜里睡不好',
  ],
}

interface ProviderDefault {
  id: string
  definitionId: string
  config: Record<string, unknown>
}

/**
 * The module choices that this build serves.
 *
 * The provider and model fields name the source that the build selects for a
 * new browser. The provider lists name every source that the build configures,
 * because a character card may point at any of them without breaking.
 */
interface ServedModules {
  consciousnessProvider: string
  consciousnessModel: string
  chatProviders: readonly string[]
  speechProvider: string
  speechProviders: readonly string[]
  /**
   * Endpoint fields that this build owns, per provider id.
   *
   * A later build can point the product at a different server, so these values
   * replace what a stored record holds. Fields that the user owns, such as an
   * API key, stay out of this map.
   */
  ownedConfig: Record<string, Record<string, unknown>>
}

function readObject(key: string): Record<string, unknown> {
  const raw = window.localStorage.getItem(key)
  if (!raw)
    return {}

  try {
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
      return parsed as Record<string, unknown>
  }
  catch {
    // A damaged value is replaced by the defaults below.
  }

  return {}
}

function envValue(value: string | undefined): string {
  return value?.trim() ?? ''
}

function readStringList(key: string): string[] {
  const raw = window.localStorage.getItem(key)
  if (!raw)
    return []

  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed))
      return parsed.filter(item => typeof item === 'string')
  }
  catch {
    // A damaged value is replaced by the defaults below.
  }

  return []
}

/**
 * Adds the provider record and marks the provider as added.
 *
 * The record carries the credentials that the endpoint needs, and the character
 * card names the provider, so the runtime fails without it. A record that
 * already exists stays, because the user can change its values there. The
 * status is `configured` because the module pages read any other status as a
 * failed health check, and this build points at the endpoint that the operator
 * ships. The application validates the provider again when the user opens its
 * settings page, so a broken endpoint corrects the status.
 */
function writeProviderRecord(record: ProviderDefault): void {
  const records = readObject(PROVIDERS_KEY)
  if (!records[record.id]) {
    records[record.id] = {
      id: record.id,
      definitionId: record.definitionId,
      config: record.config,
      status: 'configured',
      configuredBy: 'user',
    }
    window.localStorage.setItem(PROVIDERS_KEY, JSON.stringify(records))
  }

  const added = readObject(ADDED_PROVIDERS_KEY)
  if (!added[record.id]) {
    added[record.id] = true
    window.localStorage.setItem(ADDED_PROVIDERS_KEY, JSON.stringify(added))
  }
}

/**
 * Writes the provider records of this deployment while a browser lacks them.
 *
 * The records carry the credentials that each shipped source needs. The
 * character card and the module selections name those sources, so the runtime
 * fails without the records. This pass runs on every start, because a settings
 * reset removes the records and leaves the defaults version alone.
 *
 * @returns the module choices that this build serves
 */
function ensureDeploymentProviders(): ServedModules {
  const served: ServedModules = {
    consciousnessProvider: '',
    consciousnessModel: '',
    chatProviders: [],
    speechProvider: '',
    speechProviders: [],
    ownedConfig: {},
  }

  const llmBaseUrl = envValue(import.meta.env.VITE_DEFAULT_LLM_BASE_URL)
  const llmModel = envValue(import.meta.env.VITE_DEFAULT_LLM_MODEL)
  const llmApiKey = envValue(import.meta.env.VITE_DEFAULT_LLM_API_KEY)
  const deepseekApiKey = envValue(import.meta.env.VITE_DEFAULT_DEEPSEEK_API_KEY)
  const deepseekModel = envValue(import.meta.env.VITE_DEFAULT_DEEPSEEK_MODEL)
  const speechBaseUrl = envValue(import.meta.env.VITE_DEFAULT_SPEECH_BASE_URL)
  const speechApiKey = envValue(import.meta.env.VITE_DEFAULT_SPEECH_API_KEY)
  const speechModel = envValue(import.meta.env.VITE_DEFAULT_SPEECH_MODEL)
  const speechVoice = envValue(import.meta.env.VITE_DEFAULT_SPEECH_VOICE)

  if (llmBaseUrl) {
    writeProviderRecord({
      id: 'openai-compatible',
      definitionId: 'openai-compatible',
      config: {
        baseUrl: llmBaseUrl,
        // The OpenAI-compatible validator rejects an empty key, even when the
        // endpoint ignores the value.
        apiKey: llmApiKey || 'sk-build-default',
      },
    })
    served.consciousnessProvider = 'openai-compatible'
    served.consciousnessModel = llmModel
    served.chatProviders = [...served.chatProviders, 'openai-compatible']
    served.ownedConfig['openai-compatible'] = { baseUrl: llmBaseUrl }
  }

  if (deepseekApiKey) {
    // DeepSeek is a chat source of its own. The runtime reads its model list
    // from the API, so the record carries the key only.
    writeProviderRecord({
      id: 'deepseek',
      definitionId: 'deepseek',
      config: { apiKey: deepseekApiKey, thinkingMode: 'auto' },
    })
    served.chatProviders = [...served.chatProviders, 'deepseek']

    // A named model makes DeepSeek the chat source that this build selects. The
    // endpoint above stays configured, so the user can switch to it.
    if (deepseekModel) {
      served.consciousnessProvider = 'deepseek'
      served.consciousnessModel = deepseekModel
    }
  }

  if (speechBaseUrl) {
    writeProviderRecord({
      id: 'mimo-audio-speech',
      definitionId: 'mimo-audio-speech',
      config: {
        baseUrl: speechBaseUrl,
        // An absent key leaves the field empty, so the user can paste a key in
        // the settings page. The provider stays listed either way.
        ...(speechApiKey ? { apiKey: speechApiKey } : {}),
        ...(speechModel ? { model: speechModel } : {}),
        ...(speechVoice ? { voice: speechVoice } : {}),
      },
    })
    served.speechProvider = 'mimo-audio-speech'
    served.speechProviders = [...served.speechProviders, 'mimo-audio-speech']
    served.ownedConfig['mimo-audio-speech'] = {
      baseUrl: speechBaseUrl,
      ...(speechModel ? { model: speechModel } : {}),
      ...(speechVoice ? { voice: speechVoice } : {}),
    }
  }

  return served
}

/**
 * Drops the stored provider records once per `VITE_PROVIDER_PURGE_VERSION`.
 *
 * NOTICE:
 * Why: a deployment that rotates a provider credential must reach the browsers
 * that still hold the old one. `writeProviderRecord` never replaces a record
 * that exists, so a rotated key leaves every earlier browser on an invalid
 * credential, and chat fails with an upstream 401 that the visitor cannot
 * explain.
 * Root cause: the stored record mixes deployment configuration with the
 * visitor's own edits, and nothing records which of the two a value is.
 * Observed: 2026-10-19, the DeepSeek key was rotated during internal testing.
 * Removal condition: replace with source-marked overwrites (a value this
 * deployment wrote is replaceable, a value the visitor typed is not), or route
 * the provider calls through the server so the browser holds no key at all.
 *
 * Dropping the records, rather than blanking their keys, is what makes
 * `ensureDeploymentProviders` write them again with this build's credentials.
 * It also discards a provider that the visitor added, which is acceptable while
 * the purge is an explicit, deliberate action.
 */
function purgeProviderRecordsOnce(): void {
  const purgeVersion = envValue(import.meta.env.VITE_PROVIDER_PURGE_VERSION)
  if (!purgeVersion)
    return

  if (window.localStorage.getItem(PROVIDER_PURGE_KEY) === purgeVersion)
    return

  window.localStorage.removeItem(PROVIDERS_KEY)
  window.localStorage.removeItem(ADDED_PROVIDERS_KEY)
  window.localStorage.setItem(PROVIDER_PURGE_KEY, purgeVersion)
}

/**
 * Writes the endpoint fields of this build into records that a browser holds.
 *
 * A stored record keeps the values that the user changed, such as an API key.
 * The endpoint fields arrive from the build, because a later build can point the
 * product at a different server. Without this refresh, that build never reaches
 * a browser that stored the earlier address.
 */
function refreshProviderEndpoints(ownedConfig: Record<string, Record<string, unknown>>): void {
  const records = readObject(PROVIDERS_KEY)
  let changed = false

  for (const [providerId, owned] of Object.entries(ownedConfig)) {
    const record = records[providerId] as { config?: Record<string, unknown> } | undefined
    if (!record || typeof record.config !== 'object' || record.config === null)
      continue

    if (Object.entries(owned).every(([key, value]) => record.config?.[key] === value))
      continue

    record.config = { ...record.config, ...owned }
    changed = true
  }

  if (changed)
    window.localStorage.setItem(PROVIDERS_KEY, JSON.stringify(records))
}

/**
 * Writes one module choice.
 *
 * A forced write replaces any stored value. The deployment owns the provider
 * and model choices, so a new defaults version must repair a browser that
 * points at a provider this deployment does not serve.
 *
 * VueUse stores a string value as a raw string, without JSON quotes.
 */
function writeChoice(key: string, value: string, options: { force?: boolean } = {}): void {
  const current = window.localStorage.getItem(key)
  const replaceable = [...(UNCHOSEN_VALUES[key] ?? []), ...(SHIPPED_VALUES[key] ?? [])]
  if (!options.force && current !== null && !replaceable.includes(current))
    return

  window.localStorage.setItem(key, value)
}

/**
 * The same idea for values that use JSON, such as numbers and objects.
 *
 * The list holds the JSON text of each value that is still free to change,
 * because that is what a comparison with storage must use.
 */
function writeJsonChoice(key: string, value: unknown, replaceable: readonly string[]): void {
  const current = window.localStorage.getItem(key)
  if (current !== null && !replaceable.includes(current))
    return

  window.localStorage.setItem(key, JSON.stringify(value))
}

/**
 * Reads the stored card map.
 *
 * VueUse stores a Map as an array of `[id, value]` pairs. The function returns
 * `undefined` for a value this module must not replace, so a damaged or
 * unexpected value stays for the application to handle.
 */
function readCardPairs(): Array<[string, unknown]> | undefined {
  const raw = window.localStorage.getItem(CARDS_KEY)
  if (!raw)
    return []

  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed))
      return undefined

    return parsed.filter(entry => Array.isArray(entry) && typeof entry[0] === 'string')
  }
  catch {
    return undefined
  }
}

/**
 * Reports whether a card points at modules that this build cannot run.
 *
 * A card can carry the choices of another deployment. The runtime then fails on
 * a missing credential record, so a source without a record must not stay
 * active. A source that this build configures is usable, so a card that picks
 * one of those stays, even when it is not the source that this build selects.
 *
 * The selected source must name the model that this build names. A stored model
 * name can be one that the endpoint no longer holds, which fails every request.
 */
function cardNeedsShippedCard(card: unknown, served: ServedModules): boolean {
  const extensions = (card as {
    extensions?: { airi?: { modules?: Record<string, { provider?: string, model?: string }> } }
  } | undefined)?.extensions
  const modules = extensions?.airi?.modules
  if (!modules)
    return false

  const consciousness = modules.consciousness
  if (consciousness?.provider) {
    if (!served.chatProviders.includes(consciousness.provider))
      return true
    if (
      consciousness.provider === served.consciousnessProvider
      && served.consciousnessModel
      && consciousness.model
      && consciousness.model !== served.consciousnessModel
    ) {
      return true
    }
  }

  const speech = modules.speech
  if (speech?.provider && speech.provider !== 'speech-noop' && !served.speechProviders.includes(speech.provider))
    return true

  return false
}

/**
 * Points the stored copy of the shipped card at the module choices of this
 * build.
 *
 * The runtime applies the active card when it starts, so a stored copy that
 * still names an older provider or model overrides the choices that this module
 * writes. The card also carries author content, such as the persona and the
 * greeting; those fields stay as the user left them.
 *
 * @returns whether the card map must be written back
 */
function refreshShippedCardModules(card: unknown): boolean {
  const shipped = (xiaoqingCard as {
    extensions?: { airi?: { modules?: Record<string, unknown> } }
  }).extensions?.airi?.modules
  if (!shipped || typeof card !== 'object' || card === null)
    return false

  const extensions = (card as { extensions?: unknown }).extensions
  if (typeof extensions !== 'object' || extensions === null)
    return false

  const airi = (extensions as { airi?: unknown }).airi
  if (typeof airi !== 'object' || airi === null)
    return false

  const record = airi as { modules?: unknown }
  if (JSON.stringify(record.modules) === JSON.stringify(shipped))
    return false

  record.modules = shipped
  return true
}

/**
 * Adds the character card that this build ships, and keeps a working card
 * active.
 *
 * A card that an earlier build offered and the user then removed stays removed.
 * The active card changes while it is absent, still the built-in card, or bound
 * to modules that this build does not serve. A user who picked a usable
 * character keeps that choice.
 */
function writeCharacterDefault(served: ServedModules): void {
  const seeded = readStringList(SEEDED_CARDS_KEY)
  const pairs = readCardPairs()
  if (!pairs)
    return

  const shippedIndex = pairs.findIndex(([id]) => id === DEFAULT_CARD_ID)
  let cardsChanged = false

  if (shippedIndex === -1) {
    if (!seeded.includes(DEFAULT_CARD_ID)) {
      pairs.push([DEFAULT_CARD_ID, xiaoqingCard])
      cardsChanged = true
    }
  }
  else if (refreshShippedCardModules(pairs[shippedIndex][1])) {
    cardsChanged = true
  }

  if (cardsChanged)
    window.localStorage.setItem(CARDS_KEY, JSON.stringify(pairs))

  if (!seeded.includes(DEFAULT_CARD_ID))
    window.localStorage.setItem(SEEDED_CARDS_KEY, JSON.stringify([...seeded, DEFAULT_CARD_ID]))

  const activeCardId = window.localStorage.getItem(ACTIVE_CARD_KEY) ?? ''
  if (activeCardId === DEFAULT_CARD_ID)
    return

  const activeCard = pairs.find(([id]) => id === activeCardId)?.[1]
  const needsShippedCard = activeCardId === ''
    || UNCHOSEN_CARD_IDS.includes(activeCardId)
    || cardNeedsShippedCard(activeCard, served)

  if (needsShippedCard)
    window.localStorage.setItem(ACTIVE_CARD_KEY, DEFAULT_CARD_ID)
}

/**
 * Writes the build defaults once per defaults version.
 *
 * The defaults version is part of the environment. A new value applies the
 * defaults again, which is how a later build changes an existing browser.
 */
export function applyBuildDefaults(): void {
  if (typeof window === 'undefined' || !window.localStorage)
    return

  // The interface language is not handled here. `index.html` writes it before
  // any module loads, because the settings store reads the key on mount and
  // would otherwise keep a value that an earlier load derived from the browser.

  // A rotated credential must replace the stored one. This runs before the
  // records are ensured, so the rebuild below carries this build's key.
  purgeProviderRecordsOnce()

  // The sources of this deployment must exist on every start. A settings reset
  // removes their records and leaves the defaults version alone, so a pass that
  // waits for a new version would never repair that browser.
  const served = ensureDeploymentProviders()

  const version = envValue(import.meta.env.VITE_DEFAULT_CONFIG_VERSION)
  if (!version)
    return

  if (window.localStorage.getItem(APPLIED_VERSION_KEY) === version)
    return

  const speechModel = envValue(import.meta.env.VITE_DEFAULT_SPEECH_MODEL)
  const speechVoice = envValue(import.meta.env.VITE_DEFAULT_SPEECH_VOICE)
  const displayModelId = envValue(import.meta.env.VITE_DEFAULT_DISPLAY_MODEL)

  // NOTICE:
  // These writes carry no `force`, so a selection that the visitor made
  // survives a later defaults version. The restore action in the settings page
  // deletes the keys, and the next start writes the deployment default again.
  // The display model below is the deliberate exception: it belongs to the
  // deployment.
  if (served.consciousnessProvider) {
    writeChoice(CONSCIOUSNESS_PROVIDER_KEY, served.consciousnessProvider)
    if (served.consciousnessModel)
      writeChoice(CONSCIOUSNESS_MODEL_KEY, served.consciousnessModel)
  }

  if (served.speechProvider) {
    writeChoice(SPEECH_PROVIDER_KEY, served.speechProvider)
    if (speechModel)
      writeChoice(SPEECH_MODEL_KEY, speechModel)
    if (speechVoice)
      writeChoice(SPEECH_VOICE_KEY, speechVoice)
  }

  if (displayModelId) {
    // The display model belongs to the deployment like the providers do. A
    // browser that keeps an older model would not show the product character.
    writeChoice(STAGE_MODEL_KEY, displayModelId, { force: true })
  }

  writeChoice(USER_PROFILE_KEY, DEFAULT_USER_PROFILE)

  // The endpoint fields follow the build, even when the record already exists.
  refreshProviderEndpoints(served.ownedConfig)

  writeJsonChoice(LIVE2D_SCALE_KEY, DEFAULT_LIVE2D_SCALE, SHIPPED_LIVE2D_SCALES.map(scale => JSON.stringify(scale)))
  writeJsonChoice(
    LIVE2D_POSITION_KEY,
    { x: 0, y: DEFAULT_LIVE2D_POSITION_Y },
    SHIPPED_LIVE2D_POSITION_YS.map(y => JSON.stringify({ x: 0, y })),
  )

  writeCharacterDefault(served)

  window.localStorage.setItem(APPLIED_VERSION_KEY, version)
}
