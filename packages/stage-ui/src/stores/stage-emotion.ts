import type { EmotionPayload } from '../constants/emotions'

import { defineStore } from 'pinia'
import { shallowRef } from 'vue'

/**
 * Emotion that the stage is showing right now.
 *
 * The stage writes this value after an emotion reaches the renderer, and
 * surfaces such as the nurse page read it for a live badge. It is a projection,
 * never a source: the renderer keeps its own expression state, and nothing
 * applies an emotion from this store.
 */
export const useStageEmotionStore = defineStore('stage-emotion', () => {
  const current = shallowRef<EmotionPayload>()

  /** Records the emotion that the stage just handled. */
  function show(name: EmotionPayload['name'], intensity: EmotionPayload['intensity'] = 1) {
    current.value = { name, intensity }
  }

  /** Forgets the emotion, for example when the face returns to neutral. */
  function clear() {
    current.value = undefined
  }

  return { current, show, clear }
})
