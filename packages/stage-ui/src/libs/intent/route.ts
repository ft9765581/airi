import type { TurnRoute } from '@proj-airi/core-agent'

import type { IntentDecision } from './contract'

/**
 * Branch selection for one dequeued turn.
 *
 * It reads two classifier results on purpose. Urgency is a rule decision and
 * must stay one: a classifier that answers `chat` cannot delay an emergency
 * instruction. The branch itself comes from the classifier that passed the
 * evaluation gate, which is the model classifier in the shipped configuration.
 *
 * This module only decides. It composes no prompt and writes no copy, so a
 * routing change cannot silently change what the user reads.
 */

/** The `agents.medical` entry a character card may carry. */
export interface MedicalAgentConfig {
  enabled?: boolean
  prompt?: string
}

/** Why a medical turn cannot run the consultation model. */
export type MedicalAgentProblem = 'agent_missing' | 'agent_disabled' | 'prompt_empty'

/** Everything one routing decision reads. */
export interface TurnRouteInput {
  /** Rule classifier result for this message. Urgency comes from here only. */
  rules: IntentDecision
  /** The classifier that decides the branch. */
  decision: IntentDecision
  /** `agents.medical` of the active card, when the card declares one. */
  agent?: MedicalAgentConfig
}

/** What the router decided for one turn. */
export interface TurnRouteDecision {
  /** The branch, with the reason it left the chat branch. */
  route: TurnRoute
  /**
   * True when the medical branch may run the consultation model.
   *
   * False means the caller answers with fixed copy. That covers a card without a
   * usable agent, and every branch that never generates an answer.
   */
  useAgent: boolean
}

/**
 * Names why a card cannot run the consultation model, if it cannot.
 *
 * `enabled` must be an explicit `true`. A card written before this field landed
 * keeps the fixed reply, so an upgrade cannot switch medical generation on by
 * itself.
 *
 * The settings page reads this too, so the reason it shows and the reason the
 * router acts on cannot drift apart.
 */
export function medicalAgentProblem(agent: MedicalAgentConfig | undefined): MedicalAgentProblem | undefined {
  if (!agent)
    return 'agent_missing'
  if (agent.enabled !== true)
    return 'agent_disabled'
  if (!agent.prompt?.trim())
    return 'prompt_empty'

  return undefined
}

/**
 * True when the rules raised an urgency signal, fresh or inherited.
 *
 * Both codes mean the same thing to the reader: this turn needs the emergency
 * instruction. Keeping one predicate stops the router, the fixed copy and the
 * switch-off path from drifting apart.
 */
export function hasUrgentSignal(rules: IntentDecision): boolean {
  return rules.evidenceCodes.includes('red_flag') || rules.evidenceCodes.includes('red_flag_inherited')
}

/** Why the turn is urgent: a danger word in this message, or one carried over. */
export function urgentReason(rules: IntentDecision): string {
  return rules.evidenceCodes.includes('red_flag') ? 'red_flag' : 'red_flag_inherited'
}

/**
 * Chooses the branch for one turn.
 *
 * @example
 * resolveTurnRoute({ rules, decision, agent })
 * // => { route: { kind: 'medical' }, useAgent: true }
 */
export function resolveTurnRoute(input: TurnRouteInput): TurnRouteDecision {
  // A danger signal must not wait for a classifier that could disagree.
  if (hasUrgentSignal(input.rules))
    return { route: { kind: 'urgent', reason: urgentReason(input.rules) }, useAgent: false }

  // A degraded answer is not a medical judgement, so it cannot be routed as
  // one. A medical word the rules matched does not promote it either.
  if (input.decision.source === 'fallback')
    return { route: { kind: 'fallback', reason: input.decision.evidenceCodes[0] ?? 'classifier_failed' }, useAgent: false }

  if (input.decision.decision !== 'medical')
    return { route: { kind: 'chat' }, useAgent: false }

  const agentProblem = medicalAgentProblem(input.agent)
  if (agentProblem)
    return { route: { kind: 'medical', reason: agentProblem }, useAgent: false }

  return { route: { kind: 'medical' }, useAgent: true }
}
