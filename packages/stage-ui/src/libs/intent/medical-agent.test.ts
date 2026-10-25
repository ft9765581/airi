import { describe, expect, it } from 'vitest'

import { normalizeMedicalAgent } from './medical-agent'

describe('normalizeMedicalAgent', () => {
  it('keeps the opt-in and trims the prompt', () => {
    expect(normalizeMedicalAgent({ enabled: true, prompt: '  你是产康顾问  ' }))
      .toEqual({ enabled: true, prompt: '你是产康顾问' })
  })

  it('drops fields the feature does not read', () => {
    // A card can carry anything; an unknown key must not ride into an export.
    expect(normalizeMedicalAgent({ enabled: true, prompt: 'x', tools: ['shell'], model: 'gpt' }))
      .toEqual({ enabled: true, prompt: 'x' })
  })

  it('treats a non-boolean opt-in as off', () => {
    // `"true"` from a hand-edited JSON file must not enable generation.
    expect(normalizeMedicalAgent({ enabled: 'true', prompt: 'x' }))
      .toEqual({ enabled: false, prompt: 'x' })
  })

  it('drops an entry that says nothing', () => {
    expect(normalizeMedicalAgent({ prompt: '   ' })).toBeUndefined()
    expect(normalizeMedicalAgent({ enabled: false })).toBeUndefined()
    expect(normalizeMedicalAgent({})).toBeUndefined()
  })

  it('keeps a prompt without an opt-in, so the page can show why it is idle', () => {
    expect(normalizeMedicalAgent({ prompt: '你是产康顾问' }))
      .toEqual({ enabled: false, prompt: '你是产康顾问' })
  })

  it('drops values that are not an object', () => {
    expect(normalizeMedicalAgent(undefined)).toBeUndefined()
    expect(normalizeMedicalAgent(null)).toBeUndefined()
    expect(normalizeMedicalAgent('你是产康顾问')).toBeUndefined()
    expect(normalizeMedicalAgent([])).toBeUndefined()
  })
})
