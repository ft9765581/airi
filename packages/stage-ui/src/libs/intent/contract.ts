/**
 * The shared result shape for every intent classifier.
 *
 * The rule classifier and the model classifier return this same object, so the
 * evaluation page can line them up without adapting either one. `decision` is
 * the only field that routing reads. The rest exists to explain a result after
 * the fact: `scene` groups the mistake, `evidenceCodes` names the signal, and
 * `source` says which classifier answered.
 */

/** Bumped when a rule, a prompt or the model changes enough to invalidate old logs. */
export const classifierVersion = 2

/** Which classifier answers one request. */
export type IntentClassifierMode = 'rules' | 'model' | 'compare'

/** Whether a message belongs to the medical route. */
export type IntentDecisionLabel = 'medical' | 'chat'

/**
 * The topic behind one message.
 *
 * `health-consultation` covers a described symptom. `medical-knowledge` covers a
 * question about a condition. `hospital-process` covers fees, appointments and
 * paperwork. `non-medical` covers everything that stays in small talk.
 */
export type IntentScene
  = | 'health-consultation'
    | 'medical-knowledge'
    | 'hospital-process'
    | 'non-medical'

/**
 * A stable name for one signal.
 *
 * Codes never hold user text. A log or a test name can carry them, which is why
 * the evaluation page reports codes instead of the matched word.
 */
export const intentEvidenceCodes = [
  // Rule side.
  'ack',
  'empty',
  'red_flag',
  'vital_value',
  'medical_term',
  'anaphora',
  'no_signal',
  // Model side. The prompt selects from this list.
  'model:symptom',
  'model:knowledge',
  'model:process',
  'model:smalltalk',
  'model:no_signal',
  // Failure side.
  'fallback:timeout',
  'fallback:parse',
  'fallback:network',
  'fallback:not_configured',
  'fallback:error',
] as const

export type IntentEvidenceCode = (typeof intentEvidenceCodes)[number]

/** Which classifier produced a result, and whether it degraded. */
export type IntentSource = 'rule' | 'model' | 'fallback'

/** The result every classifier returns. */
export interface IntentDecision {
  decision: IntentDecisionLabel
  scene: IntentScene
  evidenceCodes: IntentEvidenceCode[]
  source: IntentSource
  classifierVersion: number
}

/** Both classifiers side by side, for the evaluation page only. */
export interface IntentComparison {
  rules: IntentDecision
  model: IntentDecision
  /** True when both classifiers agree on `decision`. */
  sameDecision: boolean
  durationMs: {
    rules: number
    model: number
  }
}
