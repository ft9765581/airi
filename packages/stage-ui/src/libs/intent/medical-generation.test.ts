import { describe, expect, it } from 'vitest'

import { allowsMedicalGeneration, parseMedicalGenerationMode } from './medical-generation'

describe('parseMedicalGenerationMode', () => {
  it('accepts the two values that turn generation on', () => {
    expect(parseMedicalGenerationMode('on')).toBe('on')
    expect(parseMedicalGenerationMode('dev')).toBe('dev')
  })

  it('falls back to off for a missing or mistyped value', () => {
    expect(parseMedicalGenerationMode(undefined)).toBe('off')
    expect(parseMedicalGenerationMode('')).toBe('off')
    expect(parseMedicalGenerationMode('yes')).toBe('off')
    expect(parseMedicalGenerationMode(true)).toBe('off')
  })
})

describe('allowsMedicalGeneration', () => {
  it('keeps the default deployment off', () => {
    expect(allowsMedicalGeneration('off', { isDevelopment: false })).toBe(false)
    expect(allowsMedicalGeneration('off', { isDevelopment: true })).toBe(false)
  })

  it('allows a development build to try the trial mode', () => {
    expect(allowsMedicalGeneration('dev', { isDevelopment: true })).toBe(true)
    // A production build that inherits the variable still stays off.
    expect(allowsMedicalGeneration('dev', { isDevelopment: false })).toBe(false)
  })

  it('allows an explicit production switch', () => {
    expect(allowsMedicalGeneration('on', { isDevelopment: false })).toBe(true)
  })
})
