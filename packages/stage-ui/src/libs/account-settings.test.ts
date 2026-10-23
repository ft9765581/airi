import { describe, expect, it } from 'vitest'

import { liftStoredCardOverride } from './account-settings'

describe('liftStoredCardOverride', () => {
  it('reads the voice and scene saved on a stored card', () => {
    const override = liftStoredCardOverride('xiaoqing', {
      extensions: {
        airi: {
          modules: {
            speech: { provider: 'official', model: 'cosyvoice', voice_id: 'warm', pitch: 1, rate: 1, ssml: false },
            activeBackgroundId: 'builtin:tea',
            displayModelId: 'preset-live2d-1',
          },
        },
      },
    }, '2026-05-01T00:00:00.000Z')

    expect(override?.speech?.voiceId).toBe('warm')
    expect(override?.scene?.backgroundId).toBe('builtin:tea')
    expect(override?.displayModel?.modelId).toBe('preset-live2d-1')
  })

  it('returns nothing when the stored card has no choices', () => {
    expect(liftStoredCardOverride('xiaoqing', { name: 'Xiaoqing' }, '2026-05-01T00:00:00.000Z')).toBeNull()
  })
})
