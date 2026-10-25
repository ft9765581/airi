/**
 * Whether this build may run the medical consultation model.
 *
 * The character card opt-in (`agents.medical.enabled`) says a card is willing to
 * use the agent. It is not a deployment decision: a card can be imported from
 * anywhere. The deployment therefore keeps its own switch, and it defaults to
 * `off`, so a build that nobody evaluated cannot start generating medical advice.
 */

/** Deployment switch for medical generation. */
export type MedicalGenerationMode = 'off' | 'dev' | 'on'

/**
 * Reads the deployment switch from the build value.
 *
 * Unknown values fall back to `off`, so a mistyped variable in a deployment
 * cannot turn generation on.
 *
 * @example
 * parseMedicalGenerationMode('dev')
 * // => 'dev'
 * @example
 * parseMedicalGenerationMode(undefined)
 * // => 'off'
 */
export function parseMedicalGenerationMode(value: unknown): MedicalGenerationMode {
  if (value === 'on')
    return 'on'
  if (value === 'dev')
    return 'dev'

  return 'off'
}

/**
 * Tells whether the switch allows generation in this build.
 *
 * @example
 * allowsMedicalGeneration('dev', { isDevelopment: false })
 * // => false
 */
export function allowsMedicalGeneration(
  mode: MedicalGenerationMode,
  options: { isDevelopment: boolean },
): boolean {
  if (mode === 'on')
    return true
  if (mode === 'dev')
    return options.isDevelopment

  return false
}
