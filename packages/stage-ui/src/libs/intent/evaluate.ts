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
 *
 * A degraded answer is a failure, never a label. The model classifier answers
 * `medical` when it cannot classify, because routing must fail safe. Scoring
 * that label would report a broken provider as a good medical classifier, so
 * every count that means "this side got it right" ignores it.
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
  /** Samples labelled medical that this classifier answered medical. */
  medicalHits: number
  /** Samples labelled chat that this classifier answered medical. */
  falsePositives: number
  /** Samples this classifier could not answer. */
  failures: number
}

/** How one classifier did on the whole set. */
export interface EvaluationSideReport {
  /** Medical hits divided by every sample labelled medical, failures included. */
  medicalRecall: number
  /** False positives divided by every sample labelled chat, failures included. */
  chatFalsePositiveRate: number
  /** Share of answers that degraded instead of classifying. Zero for rules. */
  fallbackRate: number
  groups: EvaluationGroupReport[]
  /** Labelled medical, answered chat or not answered. The expensive mistake. */
  falseNegatives: EvaluationCase[]
  /** Labelled chat, answered medical. */
  falsePositives: EvaluationCase[]
  /** Answers that degraded, so this side produced no label at all. */
  failures: EvaluationCase[]
}

/** The result of one run over the set. */
export interface EvaluationReport {
  /** Bumped with the classifiers, so an old report is not mistaken for a new one. */
  classifierVersion: number
  /** Identifies the labelled set that produced the numbers. */
  sampleSetVersion: number
  mode: IntentClassifierMode
  /** How many samples this run covered. */
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
  /** Samples where the two valid results differ, which is what the comparison is for. */
  disagreements: EvaluationCase[]
}

/** Everything one evaluation run needs. */
export interface EvaluateSamplesRequest {
  samples: IntentSample[]
  /**
   * Version of the labelled set.
   *
   * A stored report keeps it, so a run over an older set is not read as a
   * comparison with the current one.
   */
  sampleSetVersion: number
  mode: IntentClassifierMode
  /** Required unless `mode` is `rules`. */
  model?: IntentModelOptions
}

/**
 * Tells a real classification apart from a degraded answer.
 *
 * The fallback decision carries `medical` so that a later routing stage fails
 * safe. It carries no judgement, so it cannot count as a hit for either label.
 */
function isClassification(decision: IntentDecision | undefined): decision is IntentDecision {
  return !!decision && decision.source !== 'fallback'
}

function summarize(
  cases: EvaluationCase[],
  side: 'rules' | 'model',
): EvaluationSideReport {
  const scored = cases
    .map(item => ({ item, decision: item[side] }))
    .filter((row): row is { item: EvaluationCase, decision: IntentDecision } => !!row.decision)

  const expectedMedical = scored.filter(row => row.item.sample.expected === 'medical')
  const expectedChat = scored.filter(row => row.item.sample.expected === 'chat')
  const answeredMedical = (row: { decision: IntentDecision }) =>
    isClassification(row.decision) && row.decision.decision === 'medical'

  const medicalHits = expectedMedical.filter(answeredMedical)
  const falsePositives = expectedChat.filter(answeredMedical)
  const failures = scored.filter(row => !isClassification(row.decision))

  const groups = [...new Set(scored.map(row => row.item.sample.group))].map((group) => {
    const inGroup = scored.filter(row => row.item.sample.group === group)
    const groupMedical = inGroup.filter(row => row.item.sample.expected === 'medical')
    const groupChat = inGroup.filter(row => row.item.sample.expected === 'chat')

    return {
      group,
      total: inGroup.length,
      expectedMedical: groupMedical.length,
      medicalHits: groupMedical.filter(answeredMedical).length,
      falsePositives: groupChat.filter(answeredMedical).length,
      failures: inGroup.filter(row => !isClassification(row.decision)).length,
    }
  })

  return {
    medicalRecall: expectedMedical.length ? medicalHits.length / expectedMedical.length : 0,
    chatFalsePositiveRate: expectedChat.length ? falsePositives.length / expectedChat.length : 0,
    fallbackRate: scored.length ? failures.length / scored.length : 0,
    groups,
    falseNegatives: expectedMedical.filter(row => !answeredMedical(row)).map(row => row.item),
    falsePositives: falsePositives.map(row => row.item),
    failures: failures.map(row => row.item),
  }
}

/**
 * Runs one mode over the whole set and reports both sides.
 *
 * Never throws: a model failure is scored as a fallback, not as an exception.
 *
 * @example
 * const report = await evaluateSamples({ samples: intentSamples, sampleSetVersion: intentSampleSetVersion, mode: 'compare', model })
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
    const modelOptions: IntentModelOptions = request.model ?? { request: { baseURL: '', model: '' } }
    const modelStartedAt = performance.now()

    for (const item of cases) {
      // A sample's earlier turn is a user message: the fixtures carry the
      // sentence a person said before, never an assistant answer.
      const history = item.sample.previous
        ? [{ role: 'user' as const, content: item.sample.previous }]
        : undefined
      item.model = await classifyWithModel(
        { message: item.sample.input, history },
        modelOptions,
      )
    }

    modelDurationMs = performance.now() - modelStartedAt
  }

  const rules = summarize(cases, 'rules')
  const model = request.mode === 'rules' ? undefined : summarize(cases, 'model')

  const unmatched = cases.filter((item) => {
    const rulesRight = item.rules.decision === item.sample.expected
    const modelRight = isClassification(item.model) && item.model.decision === item.sample.expected
    return !rulesRight && !modelRight
  })

  // A degraded answer is not a second opinion, so it cannot make the two sides
  // "disagree". It shows up in `unmatched` and in each side's `failures`.
  const disagreements = cases.filter(item =>
    isClassification(item.model) && item.model.decision !== item.rules.decision,
  )

  return {
    classifierVersion,
    sampleSetVersion: request.sampleSetVersion,
    mode: request.mode,
    total: request.samples.length,
    durationMs: { rules: rulesDurationMs, model: modelDurationMs },
    rules,
    model,
    unmatched,
    disagreements,
  }
}
