import type { TurnRoute, TurnRouteResult } from '@proj-airi/core-agent'

import type { IntentDecision } from './contract'
import type { MedicalAgentConfig } from './route'

import { medicalGateReply, medicalGateReplyFor, medicalGateUrgentReply } from './medical-gate'
import { composeMedicalSystemPrompt } from './medical-prompt'
import { resolveTurnRoute } from './route'

/**
 * The branch of one sent turn, turned into what the runtime needs.
 *
 * `resolveTurnRoute()` answers which branch a turn takes. This module answers
 * what the turn then does: which fixed copy it writes, or which system message
 * the consultation model receives. Keeping it separate means the copy and the
 * prompt are testable without a Pinia store or a network.
 */

/** Everything one routed turn reads. */
export interface MedicalTurnInput {
  /** Rule classifier result for the message. */
  rules: IntentDecision
  /**
   * Classifies the turn with the model.
   *
   * Called only when this build may generate medical answers and urgency did not
   * already fire, so the default deployment never pays for it.
   */
  classify: () => Promise<IntentDecision>
  /** `agents.medical` of the active card. */
  agent?: MedicalAgentConfig
  /** Whether the deployment switch allows medical generation. */
  allowGeneration: boolean
}

/**
 * Builds the runtime result for one turn.
 *
 * @example
 * await routeMedicalTurn({ rules, classify, agent, allowGeneration: false })
 * // => { route: { kind: 'medical', reason: 'deployment_disabled' }, reply: '…' }
 */
export async function routeMedicalTurn(input: MedicalTurnInput): Promise<TurnRouteResult> {
  if (!input.allowGeneration) {
    // Phase-one behaviour, now inside the queue: the rules answer a medical
    // message with fixed copy, and that answer needs no provider.
    const reply = medicalGateReplyFor(input.rules)
    if (!reply)
      return { route: { kind: 'chat' } }

    const urgent = input.rules.evidenceCodes.includes('red_flag')
    return {
      route: { kind: urgent ? 'urgent' : 'medical', reason: urgent ? 'red_flag' : 'deployment_disabled' },
      reply,
    }
  }

  // A danger signal must not wait for a classifier that could disagree.
  if (input.rules.evidenceCodes.includes('red_flag'))
    return { route: { kind: 'urgent', reason: 'red_flag' }, reply: medicalGateUrgentReply }

  const decision = await input.classify()
  const routed = resolveTurnRoute({ rules: input.rules, decision, agent: input.agent })

  if (routed.route.kind === 'chat')
    return { route: routed.route }

  if (!routed.useAgent)
    return { route: routed.route, reply: medicalGateReply }

  return {
    route: routed.route,
    isolate: true,
    // `useAgent` is only true when the router found a usable card prompt.
    systemPrompt: composeMedicalSystemPrompt({ persona: input.agent?.prompt ?? '' }),
  }
}

/**
 * The reply that replaces an error bubble when a routed generation fails.
 *
 * A failed consultation is still an answer the user can act on. The reason stays
 * in telemetry, so a stack of "error" plus "fallback" never reaches the chat.
 *
 * @example
 * failedTurnReply({ kind: 'medical' })
 * // => '这个问题我暂时回答不了。…'
 * @example
 * failedTurnReply({ kind: 'chat' })
 * // => undefined
 */
export function failedTurnReply(route: TurnRoute | undefined): string | undefined {
  return route?.kind === 'medical' ? medicalGateReply : undefined
}
