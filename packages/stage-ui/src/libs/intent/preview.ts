import type { TurnRoute } from '@proj-airi/core-agent'
import type { CommonRequestOptions } from '@xsai/shared'

import type { ClassifyHistoryTurn } from './classify-model'
import type { IntentDecision } from './contract'
import type { MedicalAgentConfig } from './route'

import { errorMessageFrom } from '@moeru/std'
import { generateText } from '@xsai/generate-text'
import { message } from '@xsai/utils-chat'

import { classifyMessage } from './classify'
import { classifyRules, inheritedRedFlag } from './classify-rules'
import { routeMedicalTurn } from './turn'

/**
 * One preview run of the medical branch, from a draft the caller has not saved.
 *
 * The settings page needs to answer "what would this prompt actually say" before
 * a person saves it, and the devtools page needs to answer "what would this turn
 * do end to end". Assembling that answer on either page would copy the routing
 * and prompt code, and the copy would drift from the branch it claims to show.
 * So the run goes through the real `routeMedicalTurn()`, with the draft passed as
 * the agent and a provider passed in by the caller.
 *
 * Nothing here touches the chat store: there is no session, no queue, no memory
 * write, no drawing task and no cloud sync. The only side effect is one paid
 * model call, which is why the caller has to ask for it explicitly.
 */

/** How long one preview answer may take. */
const previewTimeoutMs = 30_000

/**
 * Output cap for the preview answer.
 *
 * One preview must not spend what an ordinary turn spends: the person is trying
 * wording, not reading a consultation.
 */
const previewMaxTokens = 600

/** Everything one preview run reads. */
export interface MedicalPreviewInput {
  /** The sample question to run through the branch. */
  message: string
  /**
   * Earlier turns, oldest first.
   *
   * The classifier reads the last two, and the rules read the last user turn:
   * "现在还是这样" only inherits an emergency from the turn right before it.
   */
  history?: ClassifyHistoryTurn[]
  /** The draft agent config. Unsaved values are fine: nothing is persisted. */
  agent?: MedicalAgentConfig
  /** Whether the deployment switch allows medical generation. */
  allowGeneration: boolean
  /** Provider options, exactly as the chat provider returns them from `chat(model)`. */
  request: CommonRequestOptions
  /**
   * Replaces the classifier prompt.
   *
   * The devtools page previews the draft it is editing, so the trial has to
   * classify with that draft. The settings page omits it and gets the default.
   */
  classifierSystemPrompt?: string
}

/** Where the system message of one trial came from. */
export type MedicalPreviewPromptSource
  /** The card's `agents.medical.prompt` plus the application constraints. */
  = | 'card-agent'
  /** A fixed reply template: no model saw the turn. */
    | 'fixed-reply'
    /** The turn stayed in ordinary chat, so no medical prompt was built. */
    | 'not-used'

/** What one preview run produced, in the order the page shows it. */
export interface MedicalPreviewResult {
  /** The branch the real router chose, so the page can name it. */
  route: TurnRoute
  /** The rule verdict, which always runs and owns urgency. */
  rules: IntentDecision
  /** The model verdict, present only when the model classifier ran. */
  model?: IntentDecision
  /**
   * Which prompt answered this turn.
   *
   * A tester needs to know whether the card's persona reached the model at all:
   * a fixed reply looks the same from the outside and costs nothing to produce.
   */
  promptSource: MedicalPreviewPromptSource
  /** The fixed copy this branch answers with, when it never reaches the model. */
  reply?: string
  /** The model's answer, when the branch generates one. */
  answer?: string
  /** Why the preview could not finish. Never thrown: a failed preview is a result. */
  failure?: string
  /** Wall time from the first rule to the last byte, for the page to show. */
  durationMs: number
}

/** The last thing the user said, which is the only turn a danger signal carries over from. */
function lastUserTurn(history: ClassifyHistoryTurn[] | undefined): string | undefined {
  return history?.filter(turn => turn.role === 'user').slice(-1)[0]?.content
}

/**
 * Runs one message through the real branch, without saving or sending anything.
 *
 * @example
 * const result = await previewMedicalTurn({ message: '宝宝黄疸怎么看', agent, allowGeneration: true, request })
 * // => { route: { kind: 'medical' }, answer: '…' }
 */
export async function previewMedicalTurn(input: MedicalPreviewInput): Promise<MedicalPreviewResult> {
  const startedAt = performance.now()
  const rules = inheritedRedFlag(input.message, lastUserTurn(input.history)) ?? classifyRules(input.message)

  let model: IntentDecision | undefined

  const routed = await routeMedicalTurn({
    rules,
    classify: async () => {
      const classified = await classifyMessage({
        message: input.message,
        mode: 'model',
        history: input.history,
        model: { request: input.request, systemPrompt: input.classifierSystemPrompt },
      })

      model = classified.mode === 'model' ? classified.decision : rules
      return model
    },
    agent: input.agent,
    allowGeneration: input.allowGeneration,
  })

  const durationMs = () => performance.now() - startedAt

  // A branch that answers with fixed copy never reaches the model, so the preview
  // costs nothing there and says exactly what the user would read.
  if (routed.reply)
    return { route: routed.route, rules, model, promptSource: 'fixed-reply', reply: routed.reply, durationMs: durationMs() }

  // An ordinary chat turn has no medical answer to preview.
  if (!routed.systemPrompt)
    return { route: routed.route, rules, model, promptSource: 'not-used', durationMs: durationMs() }

  try {
    const result = await generateText({
      ...input.request,
      max_tokens: previewMaxTokens,
      abortSignal: AbortSignal.timeout(previewTimeoutMs),
      messages: message.messages(
        message.system(routed.systemPrompt),
        message.user(input.message),
      ),
    })

    const answer = result.text?.trim()
    if (!answer)
      return { route: routed.route, rules, model, promptSource: 'card-agent', failure: '模型没有返回内容', durationMs: durationMs() }

    return { route: routed.route, rules, model, promptSource: 'card-agent', answer, durationMs: durationMs() }
  }
  catch (error) {
    return { route: routed.route, rules, model, promptSource: 'card-agent', failure: errorMessageFrom(error), durationMs: durationMs() }
  }
}
