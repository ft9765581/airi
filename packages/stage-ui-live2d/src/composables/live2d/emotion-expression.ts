import { EMOTION_ExpressionGroupCandidates_value } from '../../constants/emotions'
import { useExpressionStore } from '../../stores/expression-store'

/**
 * Picks the first expression group that the model provides for an emotion.
 *
 * Matching ignores case, because model3.json can declare `Happy` or `happy`.
 *
 * @example
 * resolveEmotionExpressionGroup('happy', ['f00', 'f04'])
 * // => 'f04'
 *
 * @example
 * resolveEmotionExpressionGroup('happy', ['smile', 'f04'])
 * // => 'smile'
 *
 * Returns `undefined` when the model provides none of the candidates, and for
 * `neutral`, which has no candidate.
 */
export function resolveEmotionExpressionGroup(
  emotion: string,
  availableGroups: Iterable<string>,
): string | undefined {
  const candidates = EMOTION_ExpressionGroupCandidates_value[emotion as keyof typeof EMOTION_ExpressionGroupCandidates_value]
  if (!candidates || candidates.length === 0)
    return undefined

  const byLowerCaseName = new Map<string, string>()
  for (const name of availableGroups)
    byLowerCaseName.set(name.toLowerCase(), name)

  for (const candidate of candidates) {
    const match = byLowerCaseName.get(candidate.toLowerCase())
    if (match)
      return match
  }

  return undefined
}

/**
 * Applies stage emotions to Live2D expressions.
 *
 * Use when:
 * - The stage receives an ACT emotion token and the renderer is Live2D.
 *
 * Expects:
 * - The Expression system setting is on. The expression controller registers
 *   the model groups only when that setting is on, because the controller
 *   replaces the Cubism expression manager and the SDK eye blink.
 *
 * Returns:
 * - The group name that is now active, or `undefined` when the model has no
 *   group for this emotion. `neutral` clears the previous group.
 */
export function useLive2DEmotionExpression() {
  const store = useExpressionStore()

  function applyEmotion(emotion: string, intensity = 1): string | undefined {
    const group = resolveEmotionExpressionGroup(emotion, store.expressionGroups.keys())
    if (!group) {
      store.clearEmotionGroup()
      return undefined
    }

    const result = store.activateEmotionGroup(group, intensity)
    return result.success ? group : undefined
  }

  return { applyEmotion }
}
