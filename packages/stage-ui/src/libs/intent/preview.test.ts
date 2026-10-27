import type { MedicalAgentConfig } from './route'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { medicalGateReply, medicalGateUrgentReply } from './medical-gate'
import { previewMedicalTurn } from './preview'

const request = {
  baseURL: 'https://example.test/v1',
  apiKey: 'test-key',
  model: 'test-model',
}

const usableAgent: MedicalAgentConfig = { enabled: true, prompt: '你是产康顾问，说话简短。' }

const medicalResult = '{"decision":"medical","scene":"health-consultation","evidenceCodes":["model:symptom"]}'
const chatResult = '{"decision":"chat","scene":"non-medical","evidenceCodes":["model:smalltalk"]}'

function completion(content: string) {
  return new Response(JSON.stringify({
    id: 'chatcmpl-test',
    object: 'chat.completion',
    created: 1,
    model: request.model,
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  }), {
    headers: { 'Content-Type': 'application/json' },
    status: 200,
  })
}

/**
 * Answers each request by role.
 *
 * The classifier asks for JSON under its own system prompt; the consultation
 * call sends the composed medical prompt instead. Reading the system prompt is
 * what lets one stub serve both without counting calls by order.
 */
let sentBodies: string[] = []

function stubProvider(options: { classify?: string, answer?: string, answerFails?: boolean }) {
  sentBodies = []
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const raw = String(init?.body ?? '{}')
    sentBodies.push(raw)
    const body = JSON.parse(raw) as { messages?: { content?: string }[] }
    const system = body.messages?.[0]?.content ?? ''

    if (system.includes('分类器'))
      return completion(options.classify ?? medicalResult)

    if (options.answerFails)
      throw new TypeError('fetch failed')

    return completion(options.answer ?? '多喂几次，注意体重增长。')
  })

  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('previewMedicalTurn', () => {
  it('answers with the fixed copy when the deployment switch is off', async () => {
    const fetchMock = stubProvider({})

    const result = await previewMedicalTurn({
      message: '宝宝黄疸怎么看',
      agent: usableAgent,
      allowGeneration: false,
      request,
    })

    expect(result.route).toEqual({ kind: 'medical', reason: 'deployment_disabled' })
    expect(result.reply).toBe(medicalGateReply)
    expect(result.answer).toBeUndefined()
    // A fixed reply costs nothing, which is the point of the switch.
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('keeps an emergency urgent without paying for a classifier call', async () => {
    const fetchMock = stubProvider({})

    const result = await previewMedicalTurn({
      message: '大量出血，头晕',
      agent: usableAgent,
      allowGeneration: true,
      request,
    })

    expect(result.route).toEqual({ kind: 'urgent', reason: 'red_flag' })
    expect(result.reply).toBe(medicalGateUrgentReply)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('stops at the chat branch instead of previewing a consultation', async () => {
    const fetchMock = stubProvider({ classify: chatResult })

    const result = await previewMedicalTurn({
      message: '今天天气不错',
      agent: usableAgent,
      allowGeneration: true,
      request,
    })

    expect(result.route).toEqual({ kind: 'chat' })
    expect(result.answer).toBeUndefined()
    expect(result.reply).toBeUndefined()
    expect(result.failure).toBeUndefined()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('previews the generated answer for a medical turn', async () => {
    const fetchMock = stubProvider({ classify: medicalResult, answer: '先看黄疸范围，再到门诊测一下胆红素。' })

    const result = await previewMedicalTurn({
      message: '宝宝黄疸怎么看',
      agent: usableAgent,
      allowGeneration: true,
      request,
    })

    expect(result.route).toEqual({ kind: 'medical' })
    expect(result.answer).toBe('先看黄疸范围，再到门诊测一下胆红素。')
    expect(result.failure).toBeUndefined()
    // One call to classify, one to answer: the page tells the reader both.
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('reports a failed answer as a result instead of throwing', async () => {
    stubProvider({ classify: medicalResult, answerFails: true })

    const result = await previewMedicalTurn({
      message: '宝宝黄疸怎么看',
      agent: usableAgent,
      allowGeneration: true,
      request,
    })

    expect(result.route).toEqual({ kind: 'medical' })
    expect(result.answer).toBeUndefined()
    expect(result.failure).toBeTruthy()
  })

  it('falls back to fixed copy when the card has no usable agent', async () => {
    stubProvider({ classify: medicalResult })

    const result = await previewMedicalTurn({
      message: '宝宝黄疸怎么看',
      agent: { enabled: false, prompt: '你是产康顾问。' },
      allowGeneration: true,
      request,
    })

    expect(result.route).toEqual({ kind: 'medical', reason: 'agent_disabled' })
    expect(result.reply).toBe(medicalGateReply)
  })

  it('inherits an emergency from the previous user turn without calling the model', async () => {
    const fetchMock = stubProvider({})

    const result = await previewMedicalTurn({
      message: '现在还是这样',
      history: [{ role: 'user', content: '大量出血，头晕' }],
      agent: usableAgent,
      allowGeneration: true,
      request,
    })

    expect(result.route).toEqual({ kind: 'urgent', reason: 'red_flag_inherited' })
    expect(result.rules.evidenceCodes).toEqual(['red_flag_inherited'])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('sends the earlier turns to the classifier as labelled history', async () => {
    stubProvider({ classify: chatResult })

    const result = await previewMedicalTurn({
      message: '那这个呢',
      history: [{ role: 'user', content: '宝宝黄疸怎么看' }],
      agent: usableAgent,
      allowGeneration: true,
      request,
    })

    expect(result.route).toEqual({ kind: 'chat' })

    const body = JSON.parse(sentBodies[0] ?? '{}') as { messages?: { content?: string }[] }
    const userContent = body.messages?.at(-1)?.content ?? ''
    expect(userContent).toContain('【上文用户】宝宝黄疸怎么看')
    expect(userContent).toContain('【当前用户消息】')
  })

  it('reports the rule and model verdicts beside the answer', async () => {
    stubProvider({ classify: medicalResult, answer: '先测胆红素。' })

    const result = await previewMedicalTurn({
      message: '宝宝黄疸怎么看',
      agent: usableAgent,
      allowGeneration: true,
      request,
    })

    expect(result.rules.source).toBe('rule')
    expect(result.model?.source).toBe('model')
    expect(result.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('classifies with the prompt the caller is editing', async () => {
    stubProvider({ classify: chatResult })

    await previewMedicalTurn({
      message: '今天天气不错',
      agent: usableAgent,
      allowGeneration: true,
      request,
      classifierSystemPrompt: '你是自定义分类器，只输出 JSON。',
    })

    const body = JSON.parse(sentBodies[0] ?? '{}') as { messages?: { content?: string }[] }
    expect(body.messages?.[0]?.content).toContain('自定义分类器')
  })
})
