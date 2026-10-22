import type { IntentModelOptions } from './classify-model'
import type { IntentClassifierMode, IntentDecision } from './contract'

import { classifyWithModel } from './classify-model'
import { classifyRules } from './classify-rules'
import { classifierVersion } from './contract'

/**
 * Offline evaluation over a labelled set.
 *
 * The point of the set is to disagree with the classifiers. A label is what a
 * person thinks the sentence means, not what any rule returns, so a report that
 * shows 100% recall on a fresh set means the set is too easy.
 *
 * The two sides are scored separately and only then compared, because "the
 * model fixed what the rules missed" and "both are wrong in the same way" need
 * different answers.
 */

/** Which slice of the set a sample belongs to. */
export type IntentSampleGroup
  = | 'medical-explicit'
    | 'medical-implicit'
    | 'medical-knowledge'
    | 'hospital-process'
    | 'chitchat'
    | 'short-reply'
    | 'asr-noise'

/** One labelled sample. */
export interface IntentSample {
  /** Stable id, so a report can name one sample. */
  id: string
  /** The message to classify. Synthetic or de-identified: never take a real user message. */
  input: string
  /** The earlier turn this sample depends on, when it needs one. */
  previous?: string
  /** The label a person assigned. */
  expected: 'medical' | 'chat'
  /** The slice this sample measures. */
  group: IntentSampleGroup
  /** True when the label changes without `previous`. */
  needsContext?: boolean
}

/** One sample together with the decisions the classifiers produced. */
export interface EvaluationCase {
  sample: IntentSample
  rules: IntentDecision
  model?: IntentDecision
}

/** How one classifier did on one group. */
export interface EvaluationGroupReport {
  group: IntentSampleGroup
  total: number
  expectedMedical: number
  /** Samples labelled medical that this classifier called medical. */
  medicalHits: number
  /** Samples labelled chat that this classifier called medical. */
  falsePositives: number
}

/** How one classifier did on the whole set. */
export interface EvaluationSideReport {
  /** Medical hits divided by samples labelled medical. */
  medicalRecall: number
  /** False positives divided by samples labelled chat. */
  chatFalsePositiveRate: number
  /** Share of answers that degraded instead of classifying. Zero for rules. */
  fallbackRate: number
  groups: EvaluationGroupReport[]
  /** Labelled medical, answered chat. The expensive mistake. */
  falseNegatives: EvaluationCase[]
  /** Labelled chat, answered medical. */
  falsePositives: EvaluationCase[]
}

/** The result of one run over the set. */
export interface EvaluationReport {
  /** Bumped with the classifiers, so an old report is not mistaken for a new one. */
  classifierVersion: number
  mode: IntentClassifierMode
  /** Share of samples the classifier answered with the right label. */
  total: number
  durationMs: {
    rules: number
    model?: number
  }
  rules: EvaluationSideReport
  /** Present when the run also asked the model. */
  model?: EvaluationSideReport
  /** Samples whose label neither side matched. */
  unmatched: EvaluationCase[]
  /** Samples where the two sides disagree, which is what the comparison is for. */
  disagreements: EvaluationCase[]
}

/** Everything one evaluation run needs. */
export interface EvaluateSamplesRequest {
  samples: IntentSample[]
  mode: IntentClassifierMode
  /** Required unless `mode` is `rules`. */
  model?: IntentModelOptions
}

function isFallback(decision: IntentDecision): boolean {
  return decision.source === 'fallback'
}

function summarize(
  cases: EvaluationCase[],
  side: 'rules' | 'model',
): EvaluationSideReport {
  const rows = cases.map(item => ({ sample: item.sample, decision: item[side] }))
    .filter((row): row is { sample: IntentSample, decision: IntentDecision } => !!row.decision)

  const expectedMedical = rows.filter(row => row.sample.expected === 'medical')
  const expectedChat = rows.filter(row => row.sample.expected === 'chat')

  const medicalHits = expectedMedical.filter(row => row.decision.decision === 'medical')
  const falsePositives = expectedChat.filter(row => row.decision.decision === 'medical')
  const fallbacks = rows.filter(row => isFallback(row.decision))

  const groups = [...new Set(rows.map(row => row.sample.group))].map((group) => {
    const inGroup = rows.filter(row => row.sample.group === group)
    return {
      group,
      total: inGroup.length,
      expectedMedical: inGroup.filter(row => row.sample.expected === 'medical').length,
      medicalHits: inGroup.filter(row => row.sample.expected === 'medical' && row.decision.decision === 'medical').length,
      falsePositives: inGroup.filter(row => row.sample.expected === 'chat' && row.decision.decision === 'medical').length,
    }
  })

  return {
    medicalRecall: expectedMedical.length ? medicalHits.length / expectedMedical.length : 0,
    chatFalsePositiveRate: expectedChat.length ? falsePositives.length / expectedChat.length : 0,
    fallbackRate: rows.length ? fallbacks.length / rows.length : 0,
    groups,
    // A fallback is counted as a hit for nothing: it is neither a correct
    // medical call nor a correct chat call.
    falseNegatives: expectedMedical
      .filter(row => row.decision.decision !== 'medical')
      .map(row => ({ sample: row.sample, rules: row.decision, model: row.decision })),
    falsePositives: falsePositives.map(row => ({ sample: row.sample, rules: row.decision, model: row.decision })),
  }
}

/**
 * Runs one mode over the whole set and reports both sides.
 *
 * Never throws: a model failure is scored as a fallback, not as an exception.
 *
 * @example
 * const report = await evaluateSamples({ samples: intentSamples, mode: 'compare', model })
 * report.rules.medicalRecall // 0.82
 * report.model?.medicalRecall // 0.97
 */
export async function evaluateSamples(request: EvaluateSamplesRequest): Promise<EvaluationReport> {
  const cases: EvaluationCase[] = []

  const rulesStartedAt = performance.now()
  for (const sample of request.samples) {
    cases.push({
      sample,
      rules: classifyRules(sample.input),
    })
  }
  const rulesDurationMs = performance.now() - rulesStartedAt

  let modelDurationMs: number | undefined
  if (request.mode !== 'rules') {
    const modelOptions: IntentModelOptions = request.model ?? { baseURL: '', model: '' }
    const modelStartedAt = performance.now()

    for (const item of cases) {
      const recentMessages = item.sample.previous ? [item.sample.previous] : undefined
      item.model = await classifyWithModel(
        { message: item.sample.input, recentMessages },
        modelOptions,
      )
    }

    modelDurationMs = performance.now() - modelStartedAt
  }

  const rules = summarize(cases, 'rules')
  const model = request.mode === 'rules' ? undefined : summarize(cases, 'model')

  const unmatched = cases.filter((item) => {
    const rulesWrong = item.rules.decision !== item.sample.expected
    const modelWrong = item.model ? item.model.decision !== item.sample.expected : true
    return rulesWrong && modelWrong
  })

  const disagreements = cases.filter(item =>
    !!item.model && item.model.decision !== item.rules.decision,
  )

  return {
    classifierVersion,
    mode: request.mode,
    total: request.samples.length,
    durationMs: { rules: rulesDurationMs, model: modelDurationMs },
    rules,
    model,
    unmatched,
    disagreements,
  }
}
