/**
 * Normalises the `agents.medical` entry before it is stored or applied.
 *
 * A character card can arrive from outside this deployment, and a settings form
 * can send a partial object, so both pass through here first. Only the two
 * fields the feature understands survive, so an unknown key cannot ride along
 * into a card export.
 */

/** The entry a card stores, with both fields present. */
export interface NormalizedMedicalAgent {
  enabled: boolean
  prompt: string
}

/**
 * Keeps the fields this feature understands, or drops an empty entry.
 *
 * An entry with neither an opt-in nor a prompt says nothing, and storing it would
 * make "not configured" read as "configured but off" on the settings page.
 *
 * @example
 * normalizeMedicalAgent({ enabled: true, prompt: '  你是产康顾问  ', extra: 1 })
 * // => { enabled: true, prompt: '你是产康顾问' }
 * @example
 * normalizeMedicalAgent({ prompt: '   ' })
 * // => undefined
 */
export function normalizeMedicalAgent(input: unknown): NormalizedMedicalAgent | undefined {
  if (!input || typeof input !== 'object')
    return undefined

  const candidate = input as { enabled?: unknown, prompt?: unknown }
  const enabled = candidate.enabled === true
  const prompt = typeof candidate.prompt === 'string' ? candidate.prompt.trim() : ''

  if (!enabled && !prompt)
    return undefined

  return { enabled, prompt }
}
