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

/** How long one classification may take before it degrades. */
const defaultTimeoutMs = 1800

/** Output cap. The answer is one small object, so this stays tight. */
const maxOutputTokens = 200

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
  baseURL: string
  apiKey?: string
  model: string
  /** @default 1800 */
  timeoutMs?: number
  /**
   * Replaces the default prompt. Only the evaluation page sets this, so a
   * person can try a wording without editing code.
   *
   * @default defaultClassifierSystemPrompt
   */
  systemPrompt?: string
  /**
   * Replaces the network call. Tests pass a fake here, so an automated run
   * never reaches a real provider.
   */
  fetch?: typeof globalThis.fetch
}

/** One message to classify, plus the turns it depends on. */
export interface ClassifyModelInput {
  message: string
  /** Older turns first. At most the last two are used. */
  recentMessages?: string[]
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
 * Classifies one message with the configured provider.
 *
 * Never throws: every failure returns a decision with `source: 'fallback'` and
 * the reason in `evidenceCodes`, so an evaluation run can continue past a bad
 * sample.
 *
 * @example
 * classifyWithModel({ message: '宝宝黄疸怎么看' }, { baseURL, apiKey, model })
 * // => { decision: 'medical', scene: 'health-consultation', source: 'model', … }
 */
export async function classifyWithModel(
  input: ClassifyModelInput,
  options: IntentModelOptions,
): Promise<IntentDecision> {
  if (!options.baseURL || !options.model)
    return fallbackDecision('fallback:not_configured')

  const history = (input.recentMessages ?? []).slice(-2)
  const userText = history.length
    ? `【前文】\n${history.join('\n')}\n\n【当前用户消息】\n${input.message}`
    : input.message

  try {
    const result = await generateText({
      baseURL: options.baseURL,
      apiKey: options.apiKey,
      model: options.model,
      temperature: 0,
      max_tokens: maxOutputTokens,
      abortSignal: AbortSignal.timeout(options.timeoutMs ?? defaultTimeoutMs),
      fetch: options.fetch,
      messages: message.messages(
        message.system(options.systemPrompt ?? defaultClassifierSystemPrompt),
        message.user(userText),
      ),
    })

    const parsed = modelResultSchema.parse(JSON.parse(stripCodeFence(result.text ?? '')))
    return toDecision(parsed)
  }
  catch (error) {
    return fallbackDecision(readFailureCode(error))
  }
}
