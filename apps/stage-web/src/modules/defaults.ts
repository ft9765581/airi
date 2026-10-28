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
import { KNOWLEDGE_BASE_RETRIEVAL_PATH, KNOWLEDGE_GRAPH_SEARCH_PATH } from '@proj-airi/stage-ui/libs/server'

import xiaoqingCard from '../assets/airi-cards/xiaoqing.json'

/**
 * The character cards that this build ships, in list order.
 *
 * A deployment serves one product, so these cards belong to the build and not
 * to the visitor: every load that applies a new defaults version replaces their
 * content with the content below. That content is the persona, the greetings,
 * the system prompt, and the module bindings. A card that the visitor creates
 * keeps its own content and is never rewritten.
 *
 * The id decides which stored card is replaced: a browser that holds a card of
 * the same id gets this content, and a browser without it gets a new card.
 */
const SHIPPED_CARDS: readonly { id: string, card: unknown }[] = [
  { id: 'xiaoqing', card: xiaoqingCard },
]

/**
 * Ids of the character cards that earlier builds shipped and this build drops.
 *
 * The card pass only adds or replaces the cards of `SHIPPED_CARDS`, so a browser
 * that holds one of these keeps it forever. The stored card map mixes the cards
 * that the deployment wrote with the cards that the visitor created, so the
 * deployment can delete only the ids it knows.
 */
const DROPPED_CARD_IDS = ['xiaoqing-prenatal', 'xiaoqing-prenatal-v2']

/**
 * Id of the card that a visitor without a usable choice starts with.
 *
 * Must name one entry of `SHIPPED_CARDS`.
 */
const DEFAULT_CARD_ID = 'xiaoqing'

/**
 * Id of the card that the runtime creates for a browser that holds none.
 *
 * `packages/stage-ui/src/stores/modules/airi-card.ts` creates it as soon as the
 * card store initializes, so this module cannot write it. It is listed here
 * because the module bindings of that card are corrected below.
 */
const BUILTIN_CARD_ID = 'default'

/**
 * Module bindings that every card of this build names, taken from the shipped
 * card files so the values live in one place.
 */
const SHIPPED_MODULES = (xiaoqingCard as {
  extensions?: { airi?: { modules?: unknown } }
}).extensions?.airi?.modules

/** Marks the defaults version that a browser already applied. */
const APPLIED_VERSION_KEY = 'settings/defaults/version'

/** Marks the provider purge value that a browser already applied. */
const PROVIDER_PURGE_KEY = 'settings/defaults/provider-purge'

const PROVIDERS_KEY = 'settings/providers/configured'
/** Where the settings store keeps its knowledge base connections. */
const KNOWLEDGE_BASE_CONNECTIONS_KEY = 'settings/knowledge-base/connections'
/**
 * Remembers the medical connection this build added.
 *
 * Without it, a visitor who removes the connection would get it back on every
 * start. The value carries the address and the knowledge id, so a later build
 * that serves another knowledge base adds that one.
 */
const MEDICAL_KNOWLEDGE_BASE_KEY = 'settings/defaults/medical-knowledge-base'
/** Where the settings store keeps its knowledge graph connections. */
const KNOWLEDGE_GRAPH_CONNECTIONS_KEY = 'settings/knowledge-graph/connections'
/**
 * Remembers the graph connection this build added.
 *
 * Same purpose and same rules as `MEDICAL_KNOWLEDGE_BASE_KEY`: a removed
 * connection stays removed, and a later build that serves another graph adds
 * that one.
 */
const MEDICAL_KNOWLEDGE_GRAPH_KEY = 'settings/defaults/medical-knowledge-graph'
const ADDED_PROVIDERS_KEY = 'settings/providers/added'

const CARDS_KEY = 'airi-cards'
const ACTIVE_CARD_KEY = 'airi-card-active-id'

/** Marks the one-time removal of the cards that this build drops. */
const DROPPED_CARDS_KEY = 'settings/defaults/dropped-cards'

/** Active card ids that mean "the user has not picked a character yet". */
const UNCHOSEN_CARD_IDS = ['', 'default']

const STAGE_MODEL_KEY = 'settings/stage/model'
const USER_PROFILE_KEY = 'settings/user-profile/content'
const LIVE2D_SCALE_KEY = 'settings/live2d/scale'
const LIVE2D_POSITION_KEY = 'settings/live2d/position'
const LIVE2D_EXPRESSION_ENABLED_KEY = 'settings/live2d/expression-enabled'

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
  // The chat source that the first builds of this deployment shipped. That
  // source named a model id the endpoint no longer holds, so every request from
  // a browser that stored it failed with 404. The card of the deployment does
  // not carry these values, so a browser that keeps them keeps the failure even
  // after the cards are rewritten.
  [CONSCIOUSNESS_PROVIDER_KEY]: ['openai-compatible'],
  [CONSCIOUSNESS_MODEL_KEY]: ['Qwen3-8B'],
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

/**
 * Adds the provider record and marks the provider as added.
 *
 * The record carries the credentials that the endpoint needs, and the character
 * card names the provider, so the runtime fails without it. A record that
 * already has a key stays, because the user can change its values there. A
 * record with an empty key receives the key from this build. The status is
 * `configured` because the module pages read any other status as a failed
 * health check, and this build points at the endpoint that the operator ships.
 * The application validates the provider again when the user opens its settings
 * page, so a broken endpoint corrects the status.
 */
/**
 * Reads the API key out of a stored provider record.
 *
 * The provider store and the storage use the same record shape, so the
 * credential repair of `credential-repair.ts` reads a record through this
 * helper instead of a second copy of the shape.
 *
 * @example
 * storedApiKey({ config: { apiKey: ' sk-test ' } })
 * // => 'sk-test'
 */
export function storedApiKey(record: unknown): string {
  const config = (record as { config?: { apiKey?: unknown } } | undefined)?.config
  return typeof config?.apiKey === 'string' ? config.apiKey.trim() : ''
}

function writeProviderRecord(record: ProviderDefault): void {
  const records = readObject(PROVIDERS_KEY)
  const existing = records[record.id] as {
    config?: Record<string, unknown>
    status?: string
  } | undefined
  const incomingKey = typeof record.config.apiKey === 'string' ? record.config.apiKey.trim() : ''

  if (!existing) {
    records[record.id] = {
      id: record.id,
      definitionId: record.definitionId,
      config: record.config,
      status: 'configured',
      configuredBy: 'user',
    }
    window.localStorage.setItem(PROVIDERS_KEY, JSON.stringify(records))
  }
  else if (incomingKey && !storedApiKey(existing)) {
    // The character card names this provider before a key exists, and the
    // runtime then stores a blank record. A later start must fill that key: an
    // existing record is otherwise left untouched, so chat keeps failing.
    const config = existing.config && typeof existing.config === 'object' ? existing.config : {}
    existing.config = { ...config, apiKey: incomingKey }
    if (!existing.status || existing.status === 'unconfigured')
      existing.status = 'configured'
    records[record.id] = existing
    window.localStorage.setItem(PROVIDERS_KEY, JSON.stringify(records))
  }

  const added = readObject(ADDED_PROVIDERS_KEY)
  if (!added[record.id]) {
    added[record.id] = true
    window.localStorage.setItem(ADDED_PROVIDERS_KEY, JSON.stringify(added))
  }
}

/**
 * Adds the medical knowledge base connection of this deployment.
 *
 * The medical branch reads only the connections marked for it, so a browser
 * that never opened the settings page answers every medical question without a
 * single reference. This pass runs on every start and adds the deployment's
 * connection once: a connection the visitor edited keeps its values, and a
 * connection the visitor removed stays removed.
 */
function ensureMedicalKnowledgeBase(): void {
  const configuredUrl = envValue(import.meta.env.VITE_KNOWLEDGE_BASE_URL)
  const serverUrl = envValue(import.meta.env.VITE_SERVER_URL)
  const baseUrl = configuredUrl || (serverUrl ? new URL(KNOWLEDGE_BASE_RETRIEVAL_PATH, serverUrl).toString() : '')
  const knowledgeBaseId = envValue(import.meta.env.VITE_KNOWLEDGE_BASE_ID)
  if (!baseUrl || !knowledgeBaseId)
    return

  const identity = `${baseUrl}|${knowledgeBaseId}`
  if (window.localStorage.getItem(MEDICAL_KNOWLEDGE_BASE_KEY) === identity)
    return

  const raw = window.localStorage.getItem(KNOWLEDGE_BASE_CONNECTIONS_KEY)
  let connections: unknown[] = []
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : []
    connections = Array.isArray(parsed) ? parsed : []
  }
  catch {
    // A damaged list is replaced by the deployment connection below.
    connections = []
  }

  const alreadyThere = connections.some((connection) => {
    const candidate = connection as Record<string, unknown>
    return candidate.scope === 'medical'
      && `${String(candidate.baseUrl ?? '')}|${String(candidate.knowledgeBaseId ?? '')}` === identity
  })

  if (!alreadyThere) {
    connections.push({
      id: 'deployment-medical',
      name: '医疗知识库',
      baseUrl,
      apiKey: '',
      knowledgeBaseId,
      enabled: true,
      scope: 'medical',
    })
    window.localStorage.setItem(KNOWLEDGE_BASE_CONNECTIONS_KEY, JSON.stringify(connections))
  }

  window.localStorage.setItem(MEDICAL_KNOWLEDGE_BASE_KEY, identity)
}

/**
 * Adds the medical knowledge graph connection of this deployment.
 *
 * The graph reads only the connections marked for the medical branch, so a
 * browser that never opened the settings page asks the graph nothing. This pass
 * runs on every start and adds the deployment's connection once: a connection the
 * visitor edited keeps its values, and a connection the visitor removed stays
 * removed.
 *
 * Why the address is not a constant:
 * - The graph service refuses browser origins, so a production build reaches it
 *   through this deployment's API. That address depends on `VITE_SERVER_URL`.
 * - `VITE_KNOWLEDGE_GRAPH_URL` overrides both, for a deployment that proxies the
 *   graph somewhere else.
 *
 * A build with neither value adds nothing: a connection with no address fails
 * every lookup and would only put a broken row in the settings page.
 */
function ensureMedicalKnowledgeGraph(): void {
  const configuredUrl = envValue(import.meta.env.VITE_KNOWLEDGE_GRAPH_URL)
  const serverUrl = envValue(import.meta.env.VITE_SERVER_URL)
  const baseUrl = configuredUrl || (serverUrl ? new URL(KNOWLEDGE_GRAPH_SEARCH_PATH, serverUrl).toString() : '')
  if (!baseUrl)
    return

  // The document id is optional: without one the service searches every published
  // graph, which is the normal setting for a deployment.
  const bookId = envValue(import.meta.env.VITE_KNOWLEDGE_GRAPH_BOOK_ID)
  const identity = `${baseUrl}|${bookId}`
  if (window.localStorage.getItem(MEDICAL_KNOWLEDGE_GRAPH_KEY) === identity)
    return

  const raw = window.localStorage.getItem(KNOWLEDGE_GRAPH_CONNECTIONS_KEY)
  let connections: unknown[] = []
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : []
    connections = Array.isArray(parsed) ? parsed : []
  }
  catch {
    // A damaged list is replaced by the deployment connection below.
    connections = []
  }

  const alreadyThere = connections.some((connection) => {
    const candidate = connection as Record<string, unknown>
    return candidate.scope === 'medical'
      && `${String(candidate.baseUrl ?? '')}|${String(candidate.bookId ?? '')}` === identity
  })

  if (!alreadyThere) {
    connections.push({
      id: 'deployment-graph',
      name: '妇幼导诊图谱',
      baseUrl,
      apiKey: '',
      ...(bookId ? { bookId } : {}),
      enabled: true,
      scope: 'medical',
    })
    window.localStorage.setItem(KNOWLEDGE_GRAPH_CONNECTIONS_KEY, JSON.stringify(connections))
  }

  window.localStorage.setItem(MEDICAL_KNOWLEDGE_GRAPH_KEY, identity)
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
 * Deletes the cards that this build drops from the stored card map.
 *
 * NOTICE:
 * Why: an earlier build shipped two extra persona cards and stopped doing so.
 * {@link syncShippedCard} only adds or replaces the cards of `SHIPPED_CARDS`, so
 * every browser that loaded the earlier build keeps them forever, and the
 * visitor cannot tell such a copy apart from a card they created themselves.
 * Root cause: the stored card map mixes entries the deployment wrote with
 * entries the visitor created, and no entry records which of the two it is.
 * Removal condition: the card map records the owner of each entry, or this
 * deployment ships those personas again.
 *
 * Runs before the defaults version check, so a browser that already applied the
 * version that shipped the cards loses them too. The marker makes the pass
 * once-ever: a card that the visitor imports later under a dropped id must
 * survive the next start.
 */
function dropDroppedCardsOnce(): void {
  if (window.localStorage.getItem(DROPPED_CARDS_KEY))
    return

  const pairs = readCardPairs()
  if (!pairs)
    return

  const kept = pairs.filter(([id]) => !DROPPED_CARD_IDS.includes(id))
  if (kept.length !== pairs.length) {
    window.localStorage.setItem(CARDS_KEY, JSON.stringify(kept))

    // The runtime keeps applying the active card on start, and the dropped card
    // is no longer in the map. An empty id makes it fall back: to the shipped
    // card when the defaults pass below runs, and to the built-in card otherwise.
    if (DROPPED_CARD_IDS.includes(window.localStorage.getItem(ACTIVE_CARD_KEY) ?? ''))
      window.localStorage.setItem(ACTIVE_CARD_KEY, '')
  }

  window.localStorage.setItem(DROPPED_CARDS_KEY, 'true')
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
 * Makes the stored copy of one shipped card equal to the card of this build.
 *
 * A build that changes a persona, a greeting, or a system prompt must reach a
 * browser that already holds the older copy of that card. The card map is a
 * VueUse `Map` serialized as `[id, card]` pairs, so a stored copy that is absent
 * is appended and a stored copy that differs is replaced whole.
 *
 * A card whose id is not shipped is never passed here, so the visitor's own
 * cards keep their content.
 *
 * @returns whether the card map must be written back
 */
function syncShippedCard(shipped: { id: string, card: unknown }, pairs: Array<[string, unknown]>): boolean {
  const index = pairs.findIndex(([id]) => id === shipped.id)

  if (index === -1) {
    pairs.push([shipped.id, shipped.card])
    return true
  }

  // Comparing the serialized form keeps a browser from rewriting the map on
  // every load, because the stored copy is the same content from an earlier
  // version.
  if (JSON.stringify(pairs[index][1]) === JSON.stringify(shipped.card))
    return false

  pairs[index][1] = shipped.card
  return true
}

/**
 * Points the stored copy of the built-in card at the modules of this build.
 *
 * The runtime creates that card (upstream names it ReLU) with the module
 * choices of the moment it was created, and it keeps them until someone
 * rewrites the card. A browser that created it while this deployment still
 * served another chat source therefore re-applies that source to the global
 * stores as soon as the visitor selects the card again.
 *
 * The card keeps its own persona: only `extensions.airi.modules` changes.
 *
 * @returns whether the card map must be written back
 */
function refreshBuiltinCardModules(pairs: Array<[string, unknown]>): boolean {
  if (!SHIPPED_MODULES)
    return false

  const card = pairs.find(([id]) => id === BUILTIN_CARD_ID)?.[1]
  if (typeof card !== 'object' || card === null)
    return false

  const extensions = (card as { extensions?: unknown }).extensions
  if (typeof extensions !== 'object' || extensions === null)
    return false

  const airi = (extensions as { airi?: unknown }).airi
  if (typeof airi !== 'object' || airi === null)
    return false

  const record = airi as { modules?: unknown }
  if (JSON.stringify(record.modules) === JSON.stringify(SHIPPED_MODULES))
    return false

  record.modules = SHIPPED_MODULES
  return true
}

/**
 * Whether this build manages the character cards of a browser.
 *
 * `VITE_SHIP_CHARACTER_CARDS=off` leaves the stored card map untouched, so each
 * browser keeps the cards it holds — its own cards, the cards that an earlier
 * build shipped, and the built-in card — as they are. It gates both card passes:
 * shipping the cards of `SHIPPED_CARDS` and dropping the cards of
 * `DROPPED_CARD_IDS`.
 *
 * Shipping a card replaces the content that the visitor may have edited under
 * the same id, so a deployment that hands the persona back to its visitors must
 * be able to stop shipping without a code change.
 */
function shipsCharacterCards(): boolean {
  return envValue(import.meta.env.VITE_SHIP_CHARACTER_CARDS) !== 'off'
}

/**
 * Makes every card of this build present with this build's content, and keeps a
 * working card active.
 *
 * NOTICE:
 * Why this deviates from upstream: upstream offers a card once, keeps author
 * content that a later build wrote, and leaves a card that the visitor removed
 * removed. This deployment ships the product personas, so a persona change must
 * reach every browser even when the visitor edited or deleted that card.
 * Removal condition: this deployment stops owning the personas.
 *
 * The active card changes while it is absent, the built-in card, or bound to
 * modules that this build does not serve. A visitor who picked a card that this
 * build can run keeps that choice.
 */
function writeCharacterDefault(served: ServedModules): void {
  const pairs = readCardPairs()
  if (!pairs)
    return

  let cardsChanged = false
  for (const shipped of SHIPPED_CARDS) {
    if (syncShippedCard(shipped, pairs))
      cardsChanged = true
  }

  // The built-in card is not ours, but its stale module bindings can put the
  // browser back on a chat source this build cannot serve.
  if (refreshBuiltinCardModules(pairs))
    cardsChanged = true

  if (cardsChanged)
    window.localStorage.setItem(CARDS_KEY, JSON.stringify(pairs))

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

  // Same reason as the provider records above: this runs on every start, because
  // a settings reset or a fresh browser must reach the same configured state.
  ensureMedicalKnowledgeBase()
  ensureMedicalKnowledgeGraph()

  // Dropping a card and shipping one are the same concern: a deployment that
  // hands the cards to its visitors does neither.
  if (shipsCharacterCards())
    dropDroppedCardsOnce()

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

  // The stage sends emotions to Live2D through the expression controller. That
  // controller replaces the SDK expression manager and the SDK eye blink, and
  // it writes parameters only while this setting is on. `false` is the plain
  // application default, so the write stays inside the versioned block: a
  // visitor who turns it off keeps that choice until this version changes.
  writeJsonChoice(LIVE2D_EXPRESSION_ENABLED_KEY, true, ['false'])

  // A deployment that has handed the persona to its visitors keeps every stored
  // card as it is, including the cards that an earlier build shipped.
  if (shipsCharacterCards())
    writeCharacterDefault(served)

  window.localStorage.setItem(APPLIED_VERSION_KEY, version)
}
