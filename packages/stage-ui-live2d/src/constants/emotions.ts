export enum Emotion {
  Happy = 'happy',
  Sad = 'sad',
  Angry = 'angry',
  Think = 'think',
  Surprise = 'surprised',
  Awkward = 'awkward',
  Question = 'question',
  Curious = 'curious',
  Neutral = 'neutral',
}

export const EMOTION_VALUES = Object.values(Emotion)

export const EmotionHappyMotionName = 'Happy'
export const EmotionSadMotionName = 'Sad'
export const EmotionAngryMotionName = 'Angry'
export const EmotionAwkwardMotionName = 'Awkward'
export const EmotionThinkMotionName = 'Think'
export const EmotionSurpriseMotionName = 'Surprise'
export const EmotionQuestionMotionName = 'Question'
export const EmotionNeutralMotionName = 'Idle'
export const EmotionCuriousMotionName = 'Curious'

export const EMOTION_EmotionMotionName_value = {
  [Emotion.Happy]: EmotionHappyMotionName,
  [Emotion.Sad]: EmotionSadMotionName,
  [Emotion.Angry]: EmotionAngryMotionName,
  [Emotion.Think]: EmotionThinkMotionName,
  [Emotion.Surprise]: EmotionSurpriseMotionName,
  [Emotion.Awkward]: EmotionAwkwardMotionName,
  [Emotion.Question]: EmotionQuestionMotionName,
  [Emotion.Neutral]: EmotionNeutralMotionName,
  [Emotion.Curious]: EmotionCuriousMotionName,
}

export const EMOTION_VRMExpressionName_value = {
  [Emotion.Happy]: 'happy',
  [Emotion.Sad]: 'sad',
  [Emotion.Angry]: 'angry',
  [Emotion.Think]: undefined,
  [Emotion.Surprise]: 'surprised',
  [Emotion.Awkward]: undefined,
  [Emotion.Question]: undefined,
  [Emotion.Neutral]: undefined,
  [Emotion.Curious]: 'surprised',
} satisfies Record<Emotion, string | undefined>

/**
 * Expression group names that Live2D tries for each emotion, in order.
 *
 * The loaded model declares the group names. The resolver uses the first
 * candidate that the model provides, so a model with semantic names
 * (`smile`, `cry`) does not depend on numbered groups.
 *
 * `f00`–`f07` are the groups of the Cubism 5 Haru sample. AIRI ships that
 * model as the default nurse preset, and the sample uses numbered names only.
 * `f00` stays unused because it only opens the mouth a little.
 *
 * `neutral` has no candidate. The resolver clears the active expression
 * instead, because the model default face is the neutral face.
 */
export const EMOTION_ExpressionGroupCandidates_value: Record<Emotion, readonly string[]> = {
  [Emotion.Happy]: ['happy', 'smile', 'joy', 'f04'],
  [Emotion.Sad]: ['sad', 'cry', 'sorrow', 'f03'],
  [Emotion.Angry]: ['angry', 'mad', 'f02'],
  [Emotion.Think]: ['think', 'serious', 'f07'],
  [Emotion.Surprise]: ['surprised', 'surprise', 'shock', 'f05'],
  [Emotion.Awkward]: ['awkward', 'shy', 'blush', 'f06'],
  [Emotion.Question]: ['question', 'confused', 'f01'],
  [Emotion.Curious]: ['curious', 'question', 'f01'],
  [Emotion.Neutral]: [],
}
