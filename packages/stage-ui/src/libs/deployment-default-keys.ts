/**
 * Storage keys that the deployment's build defaults own.
 *
 * `apps/stage-web/src/modules/defaults.ts` writes these while a key still holds
 * an unchosen value, so a selection that the visitor made survives a later
 * defaults version. A restore must delete them, or the deployment default never
 * returns.
 *
 * They live in this package because each key is the persistence key of a store
 * here. The app that ships the defaults imports them instead of repeating the
 * strings, so a rename cannot leave the two sides out of step.
 */

/** Chosen chat source, read by the consciousness store. */
export const CONSCIOUSNESS_PROVIDER_KEY = 'settings/consciousness/active-provider'

/** Chosen chat model of that source. */
export const CONSCIOUSNESS_MODEL_KEY = 'settings/consciousness/active-model'

/** Chosen speech source, read by the speech store. */
export const SPEECH_PROVIDER_KEY = 'settings/speech/active-provider'

/** Chosen speech model of that source. */
export const SPEECH_MODEL_KEY = 'settings/speech/active-model'

/** Chosen voice of that source. */
export const SPEECH_VOICE_KEY = 'settings/speech/voice'

/**
 * The module selections that the visitor owns.
 *
 * A restore deletes exactly these. The display model is deliberately absent:
 * the product character belongs to the deployment, so a build that ships a new
 * model replaces the stored one.
 */
export const VISITOR_OWNED_SELECTION_KEYS: readonly string[] = [
  CONSCIOUSNESS_PROVIDER_KEY,
  CONSCIOUSNESS_MODEL_KEY,
  SPEECH_PROVIDER_KEY,
  SPEECH_MODEL_KEY,
  SPEECH_VOICE_KEY,
]
