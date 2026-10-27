import type { ExpressionEntry, ExpressionGroupDefinition } from '../../stores/expression-store'

import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { useExpressionStore } from '../../stores/expression-store'
import { resolveEmotionExpressionGroup, useLive2DEmotionExpression } from './emotion-expression'

/** A group that closes the eyes and smiles, like `f04` of the Haru sample. */
const smileGroup: ExpressionGroupDefinition = {
  name: 'f04',
  parameters: [
    { parameterId: 'ParamEyeLSmile', blend: 'Overwrite', value: 1 },
    { parameterId: 'ParamEyeLOpen', blend: 'Overwrite', value: 0 },
    { parameterId: 'ParamBrowLY', blend: 'Overwrite', value: 0.32 },
  ],
}

/** A group that pulls the mouth down, like `f03` of the Haru sample. */
const sadGroup: ExpressionGroupDefinition = {
  name: 'f03',
  parameters: [
    { parameterId: 'ParamMouthForm', blend: 'Overwrite', value: -2 },
    { parameterId: 'ParamEyeLOpen', blend: 'Overwrite', value: 0.8 },
  ],
}

function entry(parameterId: string, modelDefault: number, blend: ExpressionEntry['blend'] = 'Overwrite'): ExpressionEntry {
  return {
    name: parameterId,
    parameterId,
    blend,
    currentValue: modelDefault,
    defaultValue: modelDefault,
    modelDefault,
    targetValue: modelDefault,
  }
}

const haruEntries: ExpressionEntry[] = [
  entry('ParamEyeLSmile', 0),
  entry('ParamEyeLOpen', 1),
  entry('ParamBrowLY', 0),
  entry('ParamMouthForm', 0),
]

describe('resolveEmotionExpressionGroup', () => {
  it('uses a semantic group name before a numbered group name', () => {
    expect(resolveEmotionExpressionGroup('happy', ['f04', 'smile'])).toBe('smile')
  })

  it('falls back to the numbered Haru group', () => {
    expect(resolveEmotionExpressionGroup('happy', ['f00', 'f04', 'f07'])).toBe('f04')
  })

  it('matches group names without case', () => {
    expect(resolveEmotionExpressionGroup('happy', ['F04'])).toBe('F04')
  })

  it('returns undefined for neutral, because no candidate exists', () => {
    expect(resolveEmotionExpressionGroup('neutral', ['f04'])).toBeUndefined()
  })

  it('returns undefined for an emotion outside the vocabulary', () => {
    expect(resolveEmotionExpressionGroup('worried', ['f04'])).toBeUndefined()
  })

  it('returns undefined when the model provides no candidate', () => {
    expect(resolveEmotionExpressionGroup('happy', ['f00', 'f01'])).toBeUndefined()
  })
})

describe('useLive2DEmotionExpression', () => {
  let store: ReturnType<typeof useExpressionStore>

  beforeEach(() => {
    setActivePinia(createPinia())
    store = useExpressionStore()
    store.registerExpressions('haru-nurse', [smileGroup, sadGroup], haruEntries)
  })

  it('applies the exp3 values of the group at full intensity', () => {
    // ROOT CAUSE:
    //
    // The stage sent emotions to Live2D as motion group names. The shipped
    // nurse model declares `Idle` and `Tap` only, so every emotion started a
    // missing group and the face never changed.
    //
    // We fixed this by driving the exp3 expression groups instead. The emotion
    // channel now writes parameters, and the model default face is `neutral`.
    const applied = useLive2DEmotionExpression().applyEmotion('happy')

    expect(applied).toBe('f04')
    expect(store.expressions.get('ParamEyeLSmile')?.currentValue).toBe(1)
    expect(store.expressions.get('ParamEyeLOpen')?.currentValue).toBe(0)
    expect(store.expressions.get('ParamBrowLY')?.currentValue).toBe(0.32)
  })

  it('moves each parameter from the model default by the intensity', () => {
    useLive2DEmotionExpression().applyEmotion('happy', 0.5)

    expect(store.expressions.get('ParamEyeLSmile')?.currentValue).toBe(0.5)
    expect(store.expressions.get('ParamEyeLOpen')?.currentValue).toBe(0.5)
    expect(store.expressions.get('ParamBrowLY')?.currentValue).toBe(0.16)
  })

  it('restores the model default at intensity 0', () => {
    useLive2DEmotionExpression().applyEmotion('sad')
    useLive2DEmotionExpression().applyEmotion('sad', 0)

    expect(store.expressions.get('ParamMouthForm')?.currentValue).toBe(0)
    expect(store.expressions.get('ParamEyeLOpen')?.currentValue).toBe(1)
  })

  it('clears the previous group before it applies the next one', () => {
    const emotion = useLive2DEmotionExpression()

    emotion.applyEmotion('happy')
    expect(store.expressions.get('ParamEyeLSmile')?.currentValue).toBe(1)

    emotion.applyEmotion('sad')

    // `f04` sets these parameters and `f03` does not, so they must return to
    // the model default. A leftover value would mix two expressions.
    expect(store.expressions.get('ParamEyeLSmile')?.currentValue).toBe(0)
    expect(store.expressions.get('ParamBrowLY')?.currentValue).toBe(0)
    expect(store.expressions.get('ParamMouthForm')?.currentValue).toBe(-2)
  })

  it('clears the active group on neutral', () => {
    const emotion = useLive2DEmotionExpression()

    emotion.applyEmotion('happy')
    const applied = emotion.applyEmotion('neutral')

    expect(applied).toBeUndefined()
    expect(store.expressions.get('ParamEyeLSmile')?.currentValue).toBe(0)
    expect(store.expressions.get('ParamEyeLOpen')?.currentValue).toBe(1)
  })

  it('replaces a group that the settings UI toggled', () => {
    // ROOT CAUSE:
    //
    // The emotion channel only cleared the group that it activated itself. A
    // group that the settings preview toggled stayed applied, and the next
    // emotion added its own parameters on top. `f03` and `f04` share
    // `ParamEyeLOpen`, but `ParamMouthForm` stayed at the `f03` value, so the
    // face showed a mix of both and looked stuck on "sad".
    //
    // We fixed this by clearing every group before an emotion applies.
    store.toggle('f03')
    expect(store.expressions.get('ParamMouthForm')?.currentValue).toBe(-2)

    useLive2DEmotionExpression().applyEmotion('happy')

    expect(store.expressions.get('ParamMouthForm')?.currentValue).toBe(0)
    expect(store.expressions.get('ParamEyeLSmile')?.currentValue).toBe(1)
  })

  it('clears a group that the settings UI toggled on neutral', () => {
    store.toggle('f03')

    useLive2DEmotionExpression().applyEmotion('neutral')

    expect(store.expressions.get('ParamMouthForm')?.currentValue).toBe(0)
    expect(store.expressions.get('ParamEyeLOpen')?.currentValue).toBe(1)
    expect(store.isGroupActive('f03')).toBe(false)
  })

  it('scales an Add parameter from zero and a Multiply parameter from one', () => {
    store.registerExpressions('blend-model', [
      {
        name: 'shy',
        parameters: [
          { parameterId: 'ParamTere', blend: 'Add', value: 1 },
          { parameterId: 'ParamEyeLOpen', blend: 'Multiply', value: 0 },
        ],
      },
    ], [
      entry('ParamTere', 0, 'Add'),
      entry('ParamEyeLOpen', 1, 'Multiply'),
    ])

    useLive2DEmotionExpression().applyEmotion('awkward', 0.5)

    expect(store.expressions.get('ParamTere')?.currentValue).toBe(0.5)
    expect(store.expressions.get('ParamEyeLOpen')?.currentValue).toBe(0.5)
  })
})
