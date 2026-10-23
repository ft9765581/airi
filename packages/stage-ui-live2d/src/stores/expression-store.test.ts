import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  expressionSettingsEqual,
  hasExpressionChoices,
  loadPersistedExpressionSettings,
  savePersistedExpressionSettings,
  useExpressionStore,
} from './expression-store'

class MemoryStorage implements Storage {
  #values = new Map<string, string>()

  get length() {
    return this.#values.size
  }

  clear() {
    this.#values.clear()
  }

  getItem(key: string) {
    return this.#values.has(key) ? this.#values.get(key)! : null
  }

  key(index: number) {
    return [...this.#values.keys()][index] ?? null
  }

  removeItem(key: string) {
    this.#values.delete(key)
  }

  setItem(key: string, value: string) {
    this.#values.set(key, String(value))
  }
}

describe('expression-store persistence', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.stubGlobal('localStorage', new MemoryStorage())
  })

  it('restores llm mode, exposures, defaults, and values for one model', () => {
    // ROOT CAUSE:
    //
    // Expression LLM mode and per-group exposures used to live only in memory.
    // A reload cleared them, and account sync had nothing durable to upload.
    //
    // We fixed this by persisting llmMode, llmExposed, defaults, and values
    // under expression-settings:<modelId>, then reloading them in registerExpressions.
    savePersistedExpressionSettings('model-a', {
      llmMode: 'custom',
      llmExposed: { f00: true, f01: false },
      defaults: { ParamA: 0.2 },
      values: { ParamA: 1 },
      activeGroups: { f00: true },
    })

    const store = useExpressionStore()
    store.registerExpressions('model-a', [{
      name: 'f00',
      parameters: [{ parameterId: 'ParamA', blend: 'Overwrite', value: 1 }],
    }], [{
      name: 'ParamA',
      parameterId: 'ParamA',
      blend: 'Overwrite',
      currentValue: 0,
      defaultValue: 0,
      modelDefault: 0,
      targetValue: 1,
    }])

    expect(store.llmMode).toBe('custom')
    expect(store.llmExposed.get('f00')).toBe(true)
    expect(store.expressions.get('ParamA')?.defaultValue).toBe(0.2)
    expect(store.expressions.get('ParamA')?.currentValue).toBe(1)
  })

  it('persists llm mode changes for account sync', () => {
    const store = useExpressionStore()
    store.registerExpressions('model-b', [], [])
    store.setLlmMode('all')

    expect(loadPersistedExpressionSettings('model-b').llmMode).toBe('all')
    expect(store.persistenceRevision).toBeGreaterThan(0)
  })

  it('detects expression choices that still need an account upload', () => {
    // ROOT CAUSE:
    //
    // Account sync skipped local expression blobs when the revision timestamp
    // was null. Empty none placeholders must stay local-only, but any real
    // choice must count as unsynced until the account has the same blob.
    expect(hasExpressionChoices({
      llmMode: 'none',
      llmExposed: {},
      defaults: { ParamA: 0 },
      values: { ParamA: 0 },
      activeGroups: {},
    })).toBe(false)
    expect(hasExpressionChoices({
      llmMode: 'none',
      llmExposed: {},
      defaults: {},
      values: {},
      activeGroups: { smile: true },
    })).toBe(true)
    expect(hasExpressionChoices({
      llmMode: 'none',
      llmExposed: {},
      defaults: { ParamA: 0 },
      values: { ParamA: 1 },
      activeGroups: {},
    })).toBe(true)
    expect(expressionSettingsEqual(
      { llmMode: 'all', llmExposed: {}, defaults: { ParamA: 1 }, values: { ParamA: 1 }, activeGroups: { f00: true } },
      { llmMode: 'all', llmExposed: {}, defaults: { ParamA: 1 }, values: { ParamA: 1 }, activeGroups: { f00: true } },
    )).toBe(true)
    expect(expressionSettingsEqual(
      { llmMode: 'all', llmExposed: {}, defaults: {}, values: { ParamA: 1 }, activeGroups: { f00: true } },
      { llmMode: 'none', llmExposed: {}, defaults: {}, values: {}, activeGroups: {} },
    )).toBe(false)
  })

  it('persists explicit group checkboxes across dispose and re-register', () => {
    // ROOT CAUSE:
    //
    // Parameter defaults can match exp3 targets (for example eye open = 1), so
    // checkboxes looked selected without a real user choice. Dispose also cleared
    // modelId, so a later toggle wrote nothing for account sync.
    const store = useExpressionStore()
    store.registerExpressions('model-groups', [{
      name: 'f00',
      parameters: [{ parameterId: 'ParamA', blend: 'Overwrite', value: 1 }],
    }], [{
      name: 'ParamA',
      parameterId: 'ParamA',
      blend: 'Overwrite',
      currentValue: 0,
      defaultValue: 0,
      modelDefault: 0,
      targetValue: 1,
    }])

    store.setGroupActive('f00', true)
    expect(store.isGroupActive('f00')).toBe(true)
    expect(loadPersistedExpressionSettings('model-groups').activeGroups.f00).toBe(true)

    store.dispose()
    expect(store.modelId).toBe('')
    expect(store.lastModelId).toBe('model-groups')

    store.registerExpressions('model-groups', [{
      name: 'f00',
      parameters: [{ parameterId: 'ParamA', blend: 'Overwrite', value: 1 }],
    }], [{
      name: 'ParamA',
      parameterId: 'ParamA',
      blend: 'Overwrite',
      currentValue: 0,
      defaultValue: 0,
      modelDefault: 0,
      targetValue: 1,
    }])

    expect(store.isGroupActive('f00')).toBe(true)
    expect(store.expressions.get('ParamA')?.currentValue).toBe(1)
  })

  it('applies account settings into local storage and the live model', () => {
    const store = useExpressionStore()
    store.registerExpressions('model-c', [{
      name: 'f02',
      parameters: [{ parameterId: 'ParamB', blend: 'Overwrite', value: 1 }],
    }], [{
      name: 'ParamB',
      parameterId: 'ParamB',
      blend: 'Overwrite',
      currentValue: 0,
      defaultValue: 0,
      modelDefault: 0,
      targetValue: 1,
    }])

    store.applyAccountSettings('model-c', {
      llmMode: 'custom',
      llmExposed: { f02: true },
      defaults: { ParamB: 0.5 },
      values: { ParamB: 0.5 },
      activeGroups: { f02: true },
    })

    expect(loadPersistedExpressionSettings('model-c').llmExposed.f02).toBe(true)
    expect(store.llmMode).toBe('custom')
    expect(store.expressions.get('ParamB')?.currentValue).toBe(0.5)
  })
})
