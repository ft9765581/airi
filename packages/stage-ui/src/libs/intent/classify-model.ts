import type { CommonRequestOptions } from '@xsai/shared'

import type { IntentDecision, IntentEvidenceCode } from './contract'

import { errorMessageFrom } from '@moeru/std'
import { generateText } from '@xsai/generate-text'
import { message } from '@xsai/utils-chat'
import { z } from 'zod'

import { classifierVersion } from './contract'

/**
 * The model classifier: asks the configured chat provider to label one message.
 *
 * It only labels. It never answers the user, reads the knowledge base or
 * touches the chat store, so a result here can never change a reply.
 *
 * The prompt asks for one JSON object. Providers that accept a JSON response
 * format are not used, because the packages this repo has do not expose that
 * option, so the reply may arrive inside a Markdown fence and the parser strips
 * it before reading.
 */

/**
 * How long one classification may take before it degrades.
 *
 * A reasoning model spends most of this budget thinking, and a provider under
 * load answers slower than its median. The earlier 1800 ms cut off answers that
 * arrived at 1500-2200 ms, and each cut counted as a failure.
 */
const defaultTimeoutMs = 4000

/**
 * Output cap.
 *
 * The answer is one small object, but a reasoning model writes its thinking
 * first from the same budget. At 200 tokens the thinking alone could fill it,
 * which ended the answer at `finish_reason: length` with no JSON at all.
 */
const maxOutputTokens = 512

/** Codes the model may return. Rules own their own codes. */
const modelEvidenceCodes = [
  'model:symptom',
  'model:knowledge',
  'model:process',
  'model:smalltalk',
  'model:no_signal',
] as const satisfies readonly IntentEvidenceCode[]

/**
 * The prompt the classifier sends when the caller does not supply one.
 *
 * The evaluation page shows this text and lets a person edit it, because the
 * wording is the whole classifier. An edited copy is not recorded in
 * `classifierVersion`, so a conclusion must be confirmed with this default.
 */
export const defaultClassifierSystemPrompt = `你是医疗场景分类器。判断用户这条消息是否属于医疗场景。

只输出一个 JSON 对象，不要解释，不要加 Markdown 代码块。

判定标准：
- medical：描述具体的身体不适或症状、问某个症状是否正常或怎么办、问用药和复查和就诊、问宝宝的健康状况。
- chat：打招呼、闲聊、说再见、只是表达情绪而没有描述具体身体情况。
- 二者都不是时选 chat。

输出格式：
{"decision":"medical","scene":"health-consultation","evidenceCodes":["model:symptom"]}

scene 只能取：health-consultation、medical-knowledge、hospital-process、non-medical
evidenceCodes 从这个列表里选，最多两个：model:symptom、model:knowledge、model:process、model:smalltalk、model:no_signal`

/**
 * The shape the model must produce.
 *
 * `decision` and `scene` are strict: a wrong value means the model did not
 * follow the contract, and the result degrades. `evidenceCodes` is checked
 * separately against the fixed list, because the enum has to stay a runtime
 * list rather than a schema literal.
 */
const modelResultSchema = z.object({
  decision: z.union([z.literal('medical'), z.literal('chat')]),
  scene: z.union([
    z.literal('health-consultation'),
    z.literal('medical-knowledge'),
    z.literal('hospital-process'),
    z.literal('non-medical'),
  ]),
  evidenceCodes: z.array(z.string()).max(4).optional(),
})

/** One provider configuration a classification needs. */
export interface IntentModelOptions {
  /**
   * Request options for the chosen model, exactly as the chat provider returns
   * them from `chat(model)`.
   *
   * The provider definition owns the address, the API key, the authentication
   * headers, the `fetch` wrapper that adds credentials, and provider-specific
   * fields such as DeepSeek `thinking`. Copying them by hand out of the stored
   * provider config loses every value that only the definition supplies: a
   * deployment that stores a DeepSeek key without an address then produces
   * `fallback:not_configured` and never sends a request.
   */
  request: CommonRequestOptions
  /**
   * Replaces the default wait. The caller lowers it only in tests.
   *
   * @default 4000
   */
  timeoutMs?: number
  /**
   * Replaces the default prompt. Only the evaluation page sets this, so a
   * person can try a wording without editing code.
   *
   * @default defaultClassifierSystemPrompt
   */
  systemPrompt?: string
}

/** One earlier turn the classifier may read. */
export interface ClassifyHistoryTurn {
  role: 'user' | 'assistant'
  content: string
}

/** One message to classify, plus the turns it depends on. */
export interface ClassifyModelInput {
  message: string
  /**
   * Older turns first, at most the last two are used.
   *
   * The role matters: "那这个呢" only becomes a medical question because the
   * turn before it described a symptom, and an answer the assistant gave is not
   * the user's own complaint.
   */
  history?: ClassifyHistoryTurn[]
}

type FailureCode = Extract<IntentEvidenceCode, `fallback:${string}`>

/**
 * A failed classification still returns a decision.
 *
 * It resolves to `medical`, which is what a later routing stage must do when it
 * has no answer. Callers that measure accuracy must read `source` and drop
 * these, otherwise a failure would count as a correct classification.
 */
function fallbackDecision(code: FailureCode): IntentDecision {
  return {
    decision: 'medical',
    scene: 'health-consultation',
    evidenceCodes: [code],
    source: 'fallback',
    classifierVersion,
  }
}

function readFailureCode(error: unknown): FailureCode {
  const name = error instanceof Error ? error.name : ''
  const text = errorMessageFrom(error) ?? ''

  if (name === 'TimeoutError' || name === 'AbortError' || /timeout|aborted/i.test(text))
    return 'fallback:timeout'

  // JSON.parse and Zod both throw a plain error with the offending shape in the
  // message, so a parse failure is told apart from a network failure by name.
  if (name === 'ZodError' || name === 'SyntaxError')
    return 'fallback:parse'

  if (name === 'TypeError')
    return 'fallback:network'

  return 'fallback:error'
}

/**
 * Removes one Markdown fence if the model wrapped its JSON in one.
 *
 * The fence is cut by index rather than with a pattern: a greedy or lazy
 * pattern over the same text backtracks on a long answer, and the lint rules
 * reject that.
 */
function stripCodeFence(text: string): string {
  const trimmed = text.trim()
  if (!trimmed.startsWith('```'))
    return trimmed

  const firstLineEnd = trimmed.indexOf('\n')
  const withoutOpening = firstLineEnd === -1 ? trimmed.slice(3) : trimmed.slice(firstLineEnd + 1)
  const closingIndex = withoutOpening.lastIndexOf('```')

  return (closingIndex === -1 ? withoutOpening : withoutOpening.slice(0, closingIndex)).trim()
}

function toDecision(input: z.infer<typeof modelResultSchema>): IntentDecision {
  const codes = (input.evidenceCodes ?? []).filter((code): code is IntentEvidenceCode =>
    (modelEvidenceCodes as readonly string[]).includes(code),
  )

  if (codes.length !== (input.evidenceCodes ?? []).length)
    throw new SyntaxError('The model returned an unknown evidence code')

  return {
    decision: input.decision,
    scene: input.scene,
    evidenceCodes: codes.length ? codes : ['model:no_signal'],
    source: 'model',
    classifierVersion,
  }
}

/**
 * Formats the earlier turns so the model can tell who said what.
 *
 * The labels are part of the classifier contract, not decoration: a symptom the
 * assistant described back is not a symptom the user reported.
 */
function formatHistory(history: ClassifyHistoryTurn[]): string {
  return history
    .map(turn => `${turn.role === 'user' ? '【上文用户】' : '【上文助手】'}${turn.content}`)
    .join('\n')
}

/**
 * Classifies one message with the configured provider.
 *
 * Never throws: every failure returns a decision with `source: 'fallback'` and
 * the reason in `evidenceCodes`, so an evaluation run can continue past a bad
 * sample. A reply that stopped on the output cap is `fallback:truncated`, not
 * `fallback:parse`, because the JSON never arrived and the request settings
 * caused it.
 *
 * @example
 * const provider = await providerStore.getChatProviderInstance(providerId, { reasoning: 'disabled' })
 * classifyWithModel({ message: '宝宝黄疸怎么看' }, { request: provider.chat(model) })
 * // => { decision: 'medical', scene: 'health-consultation', source: 'model', … }
 */
export async function classifyWithModel(
  input: ClassifyModelInput,
  options: IntentModelOptions,
): Promise<IntentDecision> {
  const { request } = options

  if (!request.baseURL || !request.model)
    return fallbackDecision('fallback:not_configured')

  const history = (input.history ?? []).slice(-2)
  const userText = history.length
    ? `${formatHistory(history)}\n\n【当前用户消息】\n${input.message}`
    : input.message

  try {
    const result = await generateText({
      ...request,
      temperature: 0,
      max_tokens: maxOutputTokens,
      abortSignal: AbortSignal.timeout(options.timeoutMs ?? defaultTimeoutMs),
      messages: message.messages(
        message.system(options.systemPrompt ?? defaultClassifierSystemPrompt),
        message.user(userText),
      ),
    })

    const content = result.text ?? ''

    // A reasoning model can spend the whole output budget before it writes the
    // first JSON character. The provider then reports `length` and the content
    // is empty or half-written, so a parse failure here would name the wrong
    // cause and hide a settings problem as a prompt problem.
    if (result.finishReason === 'length' || !content.trim())
      return fallbackDecision('fallback:truncated')

    const parsed = modelResultSchema.parse(JSON.parse(stripCodeFence(content)))
    return toDecision(parsed)
  }
  catch (error) {
    return fallbackDecision(readFailureCode(error))
  }
}
