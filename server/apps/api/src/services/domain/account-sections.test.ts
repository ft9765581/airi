import { describe, expect, it } from 'vitest'

import { mergeAccountSections } from './account-sections'

const now = new Date('2026-06-01T00:00:00.000Z')

describe('mergeAccountSections', () => {
  it('keeps a newer theme when an older modules save arrives', () => {
    const stored = mergeAccountSections(undefined, {
      system: {
        updatedAt: '2026-05-02T00:00:00.000Z',
        language: 'zh-Hans',
        disableTransitions: true,
        usePageSpecificTransitions: true,
        themeColorsHue: 220,
        themeColorsHueDynamic: false,
        analyticsEnabled: true,
      },
    }, now)

    const merged = mergeAccountSections(stored, {
      modules: {
        updatedAt: '2026-05-01T00:00:00.000Z',
        consciousness: { provider: 'openai', model: 'old', customModel: '', reasoning: false },
        hearing: {
          provider: '',
          model: '',
          customModel: '',
          autoSendEnabled: false,
          autoSendDelay: 2000,
          confidenceThreshold: -3,
        },
        vision: { provider: '', model: '', customModel: '', ollamaThinkingEnabled: false },
        webSearch: { enabled: false, apiKey: '' },
        artistry: {
          provider: 'none',
          model: '',
          promptPrefix: '',
          comfyuiServerUrl: '',
          comfyuiActiveWorkflow: '',
          replicateApiKey: '',
          replicateDefaultModel: '',
          replicateAspectRatio: '16:9',
          replicateInferenceSteps: 4,
          nanobananaApiKey: '',
          nanobananaModel: '',
          nanobananaResolution: '1K',
        },
        discord: { enabled: false, token: '' },
        twitter: { enabled: false, apiKey: '', apiSecret: '', accessToken: '', accessTokenSecret: '' },
        factorio: { enabled: false, serverAddress: '', serverPort: null, username: '' },
        mcp: { serverCmd: '', serverArgs: '' },
        beatSync: { spectrumScale: 'logarithm' },
      },
      system: {
        updatedAt: '2026-05-01T00:00:00.000Z',
        language: 'en',
        disableTransitions: false,
        usePageSpecificTransitions: false,
        themeColorsHue: 10,
        themeColorsHueDynamic: true,
        analyticsEnabled: false,
      },
    }, now)

    expect(merged.system?.language).toBe('zh-Hans')
    expect(merged.system?.themeColorsHue).toBe(220)
    expect(merged.modules?.consciousness.model).toBe('old')
  })

  it('keeps each card voice and scene on its own save time', () => {
    const stored = mergeAccountSections(undefined, {
      cardOverrides: [{
        cardId: 'xiaoqing',
        speech: {
          provider: 'official',
          model: 'cosyvoice',
          voiceId: 'warm',
          pitch: 0,
          rate: 1,
          ssml: false,
          updatedAt: '2026-05-02T00:00:00.000Z',
        },
        scene: { backgroundId: 'builtin:tea', updatedAt: '2026-05-02T00:00:00.000Z' },
      }],
    }, now)

    const merged = mergeAccountSections(stored, {
      cardOverrides: [{
        cardId: 'xiaoqing',
        speech: {
          provider: 'official',
          model: 'cosyvoice',
          voiceId: 'older-voice',
          pitch: 1,
          rate: 1,
          ssml: false,
          updatedAt: '2026-05-01T00:00:00.000Z',
        },
      }, {
        cardId: 'other',
        scene: { backgroundId: 'none', updatedAt: '2026-05-03T00:00:00.000Z' },
      }],
    }, now)

    const xiaoqing = merged.cardOverrides?.find(item => item.cardId === 'xiaoqing')
    const other = merged.cardOverrides?.find(item => item.cardId === 'other')
    expect(xiaoqing?.speech?.voiceId).toBe('warm')
    expect(xiaoqing?.scene?.backgroundId).toBe('builtin:tea')
    expect(other?.scene?.backgroundId).toBe('none')
  })

  it('keeps the newer expression settings per display model', () => {
    const now = new Date('2026-05-04T00:00:00.000Z')
    const stored = mergeAccountSections(undefined, {
      modelExpressions: [{
        modelId: 'preset-live2d-1',
        updatedAt: '2026-05-01T00:00:00.000Z',
        llmMode: 'none',
        llmExposed: {},
        defaults: { f00: 0 },
        values: { f00: 0 },
      }],
    }, now)

    const merged = mergeAccountSections(stored, {
      modelExpressions: [{
        modelId: 'preset-live2d-1',
        updatedAt: '2026-05-03T00:00:00.000Z',
        llmMode: 'custom',
        llmExposed: { f00: true },
        defaults: { f00: 1 },
        values: { f00: 1 },
      }, {
        modelId: 'preset-live2d-2',
        updatedAt: '2026-05-02T00:00:00.000Z',
        llmMode: 'all',
        llmExposed: {},
        defaults: {},
        values: {},
      }],
    }, now)

    const first = merged.modelExpressions?.find(item => item.modelId === 'preset-live2d-1')
    const second = merged.modelExpressions?.find(item => item.modelId === 'preset-live2d-2')
    expect(first?.llmMode).toBe('custom')
    expect(first?.llmExposed.f00).toBe(true)
    expect(first?.defaults.f00).toBe(1)
    expect(second?.llmMode).toBe('all')
  })
})
