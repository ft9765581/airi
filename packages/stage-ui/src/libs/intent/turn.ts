import type { ContextMessage, TurnRoute, TurnRouteResult } from '@proj-airi/core-agent'

import type { IntentDecision } from './contract'
import type { MedicalAgentConfig } from './route'

import { medicalGateReply, medicalGateReplyFor, medicalGateUrgentReply } from './medical-gate'
import { composeMedicalSystemPrompt } from './medical-prompt'
import { hasUrgentSignal, resolveTurnRoute, urgentReason } from './route'

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
  /**
   * Looks up the knowledge base records this consultation may quote.
   *
   * A medical turn is isolated, so it cannot use a runtime context provider. The
   * caller supplies the lookup here, and the reply carries the result as the
   * turn's own context. Called only when the branch really generates an answer,
   * so a fixed reply never waits for the network.
   */
  retrieveContext?: () => Promise<ContextMessage | null>
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

    const urgent = hasUrgentSignal(input.rules)
    return {
      route: { kind: urgent ? 'urgent' : 'medical', reason: urgent ? urgentReason(input.rules) : 'deployment_disabled' },
      reply,
    }
  }

  // A danger signal must not wait for a classifier that could disagree. An
  // inherited signal counts: the reader already reported the symptom on the
  // previous turn and is now saying it persists.
  if (hasUrgentSignal(input.rules))
    return { route: { kind: 'urgent', reason: urgentReason(input.rules) }, reply: medicalGateUrgentReply }

  const decision = await input.classify()
  const routed = resolveTurnRoute({ rules: input.rules, decision, agent: input.agent })

  if (routed.route.kind === 'chat')
    return { route: routed.route }

  if (!routed.useAgent)
    return { route: routed.route, reply: medicalGateReply }

  // The records arrive as context, not as system text: they are data to quote,
  // and the behaviour constraints above them must keep winning. A lookup that
  // throws costs the consultation its references, not its answer.
  let context: ContextMessage | null = null
  try {
    context = (await input.retrieveContext?.()) ?? null
  }
  catch {
    context = null
  }

  return {
    route: routed.route,
    isolate: true,
    // `useAgent` is only true when the router found a usable card prompt.
    systemPrompt: composeMedicalSystemPrompt({ persona: input.agent?.prompt ?? '' }),
    contextMessages: context ? [context] : undefined,
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
