import type { IntentModelOptions } from './classify-model'
import type { IntentClassifierMode, IntentComparison, IntentDecision } from './contract'

import { classifyWithModel } from './classify-model'
import { classifyRules } from './classify-rules'

/**
 * Mode dispatch for the two classifiers.
 *
 * `rules` and `model` answer with one decision, which is what a caller that only
 * needs a label should use. `compare` runs both and returns the pair, which is
 * what the evaluation page uses to show a disagreement.
 *
 * This module never reaches the chat store, the knowledge base or the reply
 * path. A caller gets a label and nothing else changes.
 */

/** The outcome of one classification request. */
export type ClassifyResult
  = | { mode: 'rules', decision: IntentDecision }
    | { mode: 'model', decision: IntentDecision }
    | { mode: 'compare', comparison: IntentComparison }

/** Everything one classification request needs. */
export interface ClassifyRequest {
  /** The message to label. */
  message: string
  /** Which classifier answers. */
  mode: IntentClassifierMode
  /** Older turns first. The model classifier uses at most the last two. */
  recentMessages?: string[]
  /** Provider settings. Required unless `mode` is `rules`. */
  model?: IntentModelOptions
}

function measure<T>(run: () => T): { value: T, durationMs: number } {
  const startedAt = performance.now()
  const value = run()
  return { value, durationMs: performance.now() - startedAt }
}

/**
 * Runs the classifier the request asks for.
 *
 * @example
 * const { decision } = await classifyMessage({ message: '黄疸怎么看', mode: 'rules' })
 * // => decision.decision === 'medical'
 */
export async function classifyMessage(request: ClassifyRequest): Promise<ClassifyResult> {
  if (request.mode === 'rules') {
    return { mode: 'rules', decision: measure(() => classifyRules(request.message)).value }
  }

  const modelOptions: IntentModelOptions = request.model ?? { baseURL: '', model: '' }

  if (request.mode === 'model') {
    const decision = await classifyWithModel(
      { message: request.message, recentMessages: request.recentMessages },
      modelOptions,
    )
    return { mode: 'model', decision }
  }

  // `compare` runs the rules first because they are free, then waits for the
  // model. Both durations are measured separately so a slow model is visible
  // even when the two classifiers agree.
  const ruleRun = measure(() => classifyRules(request.message))

  const modelStartedAt = performance.now()
  const modelDecision = await classifyWithModel(
    { message: request.message, recentMessages: request.recentMessages },
    modelOptions,
  )
  const modelDurationMs = performance.now() - modelStartedAt

  return {
    mode: 'compare',
    comparison: {
      rules: ruleRun.value,
      model: modelDecision,
      sameDecision: ruleRun.value.decision === modelDecision.decision,
      durationMs: {
        rules: ruleRun.durationMs,
        model: modelDurationMs,
      },
    },
  }
}
