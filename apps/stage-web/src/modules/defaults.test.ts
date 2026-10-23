import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import xiaoqingCard from '../assets/airi-cards/xiaoqing.json'

import { applyBuildDefaults } from './defaults'

const CARDS_KEY = 'airi-cards'
const ACTIVE_CARD_KEY = 'airi-card-active-id'
const DROPPED_CARDS_KEY = 'settings/defaults/dropped-cards'

type CardPairs = Array<[string, unknown]>

/** A card that an earlier build shipped and this build drops. */
const droppedCard = { name: '小清（旧孕期卡）', version: '2.0.0' }

/** A card that the visitor created. */
const ownCard = { name: '我自己的卡', version: '1.0.0', description: '自己写的设定' }

/**
 * Installs the storage that the module reads through `window.localStorage`.
 *
 * The defaults run once per `VITE_DEFAULT_CONFIG_VERSION`, so every test seeds
 * an empty version marker and lets the call apply the defaults.
 */
function installStorage(initial: Record<string, string> = {}) {
  const storage = new Map<string, string>(Object.entries(initial))
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    },
  })

  return {
    get: (key: string) => storage.get(key) ?? null,
    readCards: () => JSON.parse(storage.get(CARDS_KEY) ?? '[]') as CardPairs,
  }
}

function stubDeploymentEnv() {
  vi.stubEnv('VITE_DEFAULT_CONFIG_VERSION', 'test-version')
  // A card that names this source stays active, because the build serves it.
  vi.stubEnv('VITE_DEFAULT_DEEPSEEK_API_KEY', 'sk-test')
  vi.stubEnv('VITE_DEFAULT_DEEPSEEK_MODEL', 'deepseek-flash')
  // Vitest reads the local `.env` of the app, so every value that the assertions
  // read must be pinned here. Otherwise the expectations change with the machine.
  vi.stubEnv('VITE_DEFAULT_SPEECH_BASE_URL', '')
  vi.stubEnv('VITE_DEFAULT_SPEECH_MODEL', '')
  vi.stubEnv('VITE_DEFAULT_SPEECH_VOICE', '')
  vi.stubEnv('VITE_DEFAULT_DISPLAY_MODEL', '')
}

describe('build defaults: shipped character cards', () => {
  beforeEach(stubDeploymentEnv)

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('ships the card of this build and activates it', () => {
    const storage = installStorage()

    applyBuildDefaults()

    expect(storage.readCards()).toEqual([['xiaoqing', xiaoqingCard]])
    expect(storage.get(ACTIVE_CARD_KEY)).toBe('xiaoqing')
  })

  it('rewrites the content of a card that an earlier build shipped', () => {
    // ROOT CAUSE:
    //
    // The card of an earlier build stayed in the browser with its old persona.
    // Only `extensions.airi.modules` was refreshed, so a build that changed the
    // system prompt or a greeting never reached a browser that already held the
    // card.
    //
    //   else if (refreshShippedCardModules(pairs[shippedIndex][1])) { ... }
    //
    // We fixed this by replacing the whole stored card with the card of this
    // build, for ids that the build ships.
    const staleCard = { ...xiaoqingCard, version: '0.1.0', description: '旧版描述' }
    const storage = installStorage({
      [CARDS_KEY]: JSON.stringify([['xiaoqing', staleCard]]),
      [ACTIVE_CARD_KEY]: 'xiaoqing',
    })

    applyBuildDefaults()

    const stored = storage.readCards()
    expect(stored).toEqual([['xiaoqing', xiaoqingCard]])
  })

  it('drops the cards that this build no longer ships', () => {
    // ROOT CAUSE:
    //
    // The card pass only adds or replaces the cards that the build ships, so the
    // two extra persona cards of an earlier build stayed in every browser that
    // had loaded it, and the visitor could not tell them apart from their own
    // cards.
    //
    // We fixed this by deleting the known ids once, before the version check, so
    // a browser that already applied the version that shipped them loses them
    // too.
    const storage = installStorage({
      [CARDS_KEY]: JSON.stringify([
        ['xiaoqing', xiaoqingCard],
        ['xiaoqing-prenatal', droppedCard],
        ['xiaoqing-prenatal-v2', droppedCard],
      ]),
      [ACTIVE_CARD_KEY]: 'xiaoqing-prenatal',
    })

    applyBuildDefaults()

    expect(storage.readCards()).toEqual([['xiaoqing', xiaoqingCard]])
    // The dropped card was active, so the shipped card takes over.
    expect(storage.get(ACTIVE_CARD_KEY)).toBe('xiaoqing')
    expect(storage.get(DROPPED_CARDS_KEY)).toBe('true')
  })

  it('drops the cards once, so an import under a dropped id survives', () => {
    // The marker makes the drop once-ever. Without it, a card that the visitor
    // imports later under a dropped id would disappear on the next start.
    const storage = installStorage({
      [DROPPED_CARDS_KEY]: 'true',
      [CARDS_KEY]: JSON.stringify([['xiaoqing-prenatal', ownCard]]),
      [ACTIVE_CARD_KEY]: 'xiaoqing-prenatal',
    })

    applyBuildDefaults()

    expect(storage.readCards()).toContainEqual(['xiaoqing-prenatal', ownCard])
    expect(storage.get(ACTIVE_CARD_KEY)).toBe('xiaoqing-prenatal')
  })

  it('keeps the content of a card that the visitor created', () => {
    const storage = installStorage({
      [CARDS_KEY]: JSON.stringify([['visitor-card', ownCard]]),
      [ACTIVE_CARD_KEY]: 'visitor-card',
    })

    applyBuildDefaults()

    const stored = storage.readCards()
    expect(stored).toContainEqual(['visitor-card', ownCard])
    // A card that names no module of its own is usable, so the choice stays.
    expect(storage.get(ACTIVE_CARD_KEY)).toBe('visitor-card')
  })

  it('does not rewrite the card map when the stored content already matches', () => {
    const matching = JSON.stringify([['xiaoqing', xiaoqingCard]])
    const storage = installStorage({
      [CARDS_KEY]: matching,
      [ACTIVE_CARD_KEY]: 'xiaoqing',
    })

    applyBuildDefaults()

    // The comparison runs on the serialized form, so an unchanged browser keeps
    // its stored string instead of receiving it again on every build.
    expect(storage.get(CARDS_KEY)).toBe(matching)
  })

  it('points the built-in card at the modules of this build', () => {
    // ROOT CAUSE:
    //
    // The runtime creates the built-in card with the module choices of the
    // moment it was created and keeps them. A browser that created it while the
    // deployment served another chat source re-applied that source to the
    // global stores as soon as the visitor selected the card again, so every
    // request failed on a model id that the endpoint no longer holds.
    const staleBuiltinCard = {
      name: 'ReLU',
      version: '1.0.0',
      extensions: {
        airi: {
          modules: { consciousness: { provider: 'openai-compatible', model: 'Qwen3-8B' } },
          agents: {},
        },
      },
    }
    const storage = installStorage({
      [CARDS_KEY]: JSON.stringify([['default', staleBuiltinCard]]),
      [ACTIVE_CARD_KEY]: 'default',
    })

    applyBuildDefaults()

    const builtinCard = storage.readCards().find(([id]) => id === 'default')?.[1] as {
      extensions: { airi: { modules: unknown } }
    }
    expect(builtinCard.extensions.airi.modules).toEqual(xiaoqingCard.extensions.airi.modules)
    // The built-in card counts as "no character chosen", so the shipped card of
    // this build takes over.
    expect(storage.get(ACTIVE_CARD_KEY)).toBe('xiaoqing')
  })

  it('leaves every stored card alone when the build manages no cards', () => {
    // `VITE_SHIP_CHARACTER_CARDS=off` turns off both card passes: no shipping
    // and no dropping. The provider defaults still apply.
    vi.stubEnv('VITE_SHIP_CHARACTER_CARDS', 'off')
    const stored = JSON.stringify([
      ['xiaoqing-prenatal', droppedCard],
      ['visitor-card', ownCard],
    ])
    const storage = installStorage({
      [CARDS_KEY]: stored,
      [ACTIVE_CARD_KEY]: 'xiaoqing-prenatal',
    })

    applyBuildDefaults()

    expect(storage.get(CARDS_KEY)).toBe(stored)
    expect(storage.get(ACTIVE_CARD_KEY)).toBe('xiaoqing-prenatal')
    expect(storage.get('settings/consciousness/active-provider')).toBe('deepseek')
  })

  it('replaces the chat source that the first builds of this deployment stored', () => {
    const storage = installStorage({
      [CARDS_KEY]: JSON.stringify([['xiaoqing', xiaoqingCard]]),
      [ACTIVE_CARD_KEY]: 'xiaoqing',
      'settings/consciousness/active-provider': 'openai-compatible',
      'settings/consciousness/active-model': 'Qwen3-8B',
    })

    applyBuildDefaults()

    expect(storage.get('settings/consciousness/active-provider')).toBe('deepseek')
    expect(storage.get('settings/consciousness/active-model')).toBe('deepseek-flash')
  })
})

describe('build defaults: stage appearance', () => {
  beforeEach(stubDeploymentEnv)

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('enables the Live2D expression system that the emotion channel writes through', () => {
    const storage = installStorage()

    applyBuildDefaults()

    // Without this setting the expression controller registers no group, so
    // every emotion of the stage reaches a model that cannot show it.
    expect(storage.get('settings/live2d/expression-enabled')).toBe('true')
  })
})
