import { describe, expect, it } from 'vitest'

import { classifyWithModel, defaultClassifierSystemPrompt } from './classify-model'

/**
 * The model classifier is tested through the request's `fetch`, so an automated
 * run never reaches a provider and needs no API key. The request options are the
 * same shape the chat provider returns from `chat(model)`.
 */

const options = {
  request: {
    baseURL: 'https://provider.invalid/v1',
    apiKey: 'test-key',
    model: 'test-model',
  },
}

function completion(content: string, finishReason = 'stop') {
  return {
    id: 'completion-1',
    object: 'chat.completion',
    created: 0,
    model: 'test-model',
    system_fingerprint: 'fp-test',
    choices: [{ index: 0, finish_reason: finishReason, message: { role: 'assistant', content } }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  }
}

function respondWith(content: string, finishReason?: string): typeof globalThis.fetch {
  return async () => new Response(JSON.stringify(completion(content, finishReason)), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

/** Runs one classification and returns what it put on the wire. */
async function captureRequest(
  overrides: { request?: Record<string, unknown>, systemPrompt?: string } = {},
): Promise<{ body: Record<string, unknown>, headers: Headers }> {
  let body: Record<string, unknown> = {}
  let headers = new Headers()

  const fetchSpy: typeof globalThis.fetch = async (_input, init) => {
    body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
    headers = new Headers(init?.headers)
    return new Response(
      JSON.stringify(completion('{"decision":"chat","scene":"non-medical","evidenceCodes":["model:smalltalk"]}')),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )
  }

  await classifyWithModel(
    { message: '你好' },
    {
      request: { ...options.request, fetch: fetchSpy, ...overrides.request },
      systemPrompt: overrides.systemPrompt,
    },
  )

  return { body, headers }
}

describe('classifyWithModel', () => {
  it('reads a plain JSON answer', async () => {
    const result = await classifyWithModel(
      { message: '宝宝黄疸怎么看' },
      {
        request: {
          ...options.request,
          fetch: respondWith('{"decision":"medical","scene":"health-consultation","evidenceCodes":["model:symptom"]}'),
        },
      },
    )

    expect(result.decision).toBe('medical')
    expect(result.scene).toBe('health-consultation')
    expect(result.evidenceCodes).toEqual(['model:symptom'])
    expect(result.source).toBe('model')
  })

  it('reads an answer wrapped in a code fence', async () => {
    const result = await classifyWithModel(
      { message: '今天好累啊' },
      {
        request: {
          ...options.request,
          fetch: respondWith('```json\n{"decision":"chat","scene":"non-medical","evidenceCodes":["model:smalltalk"]}\n```'),
        },
      },
    )

    expect(result.decision).toBe('chat')
    expect(result.source).toBe('model')
  })

  it('degrades when the answer is not JSON', async () => {
    const result = await classifyWithModel(
      { message: '宝宝黄疸怎么看' },
      { request: { ...options.request, fetch: respondWith('这不是 JSON') } },
    )

    expect(result.source).toBe('fallback')
    expect(result.evidenceCodes).toEqual(['fallback:parse'])
  })

  it('degrades when a required field is not an allowed value', async () => {
    const result = await classifyWithModel(
      { message: '宝宝黄疸怎么看' },
      { request: { ...options.request, fetch: respondWith('{"decision":"maybe","scene":"non-medical"}') } },
    )

    expect(result.source).toBe('fallback')
    expect(result.evidenceCodes).toEqual(['fallback:parse'])
  })

  it('degrades when the answer carries an unknown evidence code', async () => {
    const result = await classifyWithModel(
      { message: '宝宝黄疸怎么看' },
      {
        request: {
          ...options.request,
          fetch: respondWith('{"decision":"medical","scene":"health-consultation","evidenceCodes":["made_up_code"]}'),
        },
      },
    )

    expect(result.source).toBe('fallback')
    expect(result.evidenceCodes).toEqual(['fallback:parse'])
  })

  it('degrades on a network failure', async () => {
    const result = await classifyWithModel(
      { message: '宝宝黄疸怎么看' },
      { request: { ...options.request, fetch: async () => Promise.reject(new TypeError('fetch failed')) } },
    )

    expect(result.source).toBe('fallback')
    expect(result.evidenceCodes).toEqual(['fallback:network'])
  })

  it('degrades on timeout', async () => {
    const hangingFetch: typeof globalThis.fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted.', 'AbortError'))
        })
      })

    const result = await classifyWithModel(
      { message: '宝宝黄疸怎么看' },
      { request: { ...options.request, fetch: hangingFetch }, timeoutMs: 20 },
    )

    expect(result.source).toBe('fallback')
    expect(result.evidenceCodes).toEqual(['fallback:timeout'])
  })

  it('degrades when the provider stopped on the output cap', async () => {
    // ROOT CAUSE:
    //
    // A reasoning model writes its thinking from the same output budget as the
    // answer. With a small cap the thinking fills it, so the provider ends the
    // completion at `length` and the answer never starts.
    //
    // Before the fix this arrived as an empty string and the JSON parser named
    // it `fallback:parse`, which pointed at the prompt instead of the request
    // settings, and the evaluation counted the default `medical` as a hit.
    //
    // The classifier now reads `finishReason` first and names the real cause.
    const result = await classifyWithModel(
      { message: '宝宝黄疸怎么看' },
      { request: { ...options.request, fetch: respondWith('{"decision":"', 'length') } },
    )

    expect(result.source).toBe('fallback')
    expect(result.evidenceCodes).toEqual(['fallback:truncated'])
  })

  it('degrades when the provider returns no content at all', async () => {
    const result = await classifyWithModel(
      { message: '宝宝黄疸怎么看' },
      { request: { ...options.request, fetch: respondWith('') } },
    )

    expect(result.source).toBe('fallback')
    expect(result.evidenceCodes).toEqual(['fallback:truncated'])
  })

  it('does not call a provider it was not given', async () => {
    let called = false
    const fetchSpy: typeof globalThis.fetch = async () => {
      called = true
      return new Response('{}')
    }

    const result = await classifyWithModel(
      { message: '宝宝黄疸怎么看' },
      { request: { baseURL: '', model: '', fetch: fetchSpy } },
    )

    expect(called).toBe(false)
    expect(result.source).toBe('fallback')
    expect(result.evidenceCodes).toEqual(['fallback:not_configured'])
  })

  /**
   * The provider owns the address, the credentials and its own request fields.
   * A field that never reaches the wire would look like an ignored setting.
   */
  it('sends the provider fields it was given', async () => {
    const { body } = await captureRequest({ request: { thinking: { type: 'disabled' } } })

    expect(body.thinking).toEqual({ type: 'disabled' })
    expect(body.model).toBe('test-model')
  })

  it('sends the provider headers beside the key', async () => {
    const { headers } = await captureRequest({ request: { headers: { 'x-provider-auth': 'token-1' } } })

    expect(headers.get('authorization')).toBe('Bearer test-key')
    expect(headers.get('x-provider-auth')).toBe('token-1')
  })

  /**
   * The page lets a person edit the prompt, so what it sends is worth checking:
   * a silently ignored override would look like the edit changed nothing.
   */
  it('sends the prompt it was given', async () => {
    const { body } = await captureRequest({ systemPrompt: '自定义提示词' })
    const messages = body.messages as { role: string, content: string }[]

    expect(messages.find(item => item.role === 'system')?.content).toBe('自定义提示词')
  })

  it('falls back to the default prompt when none is given', async () => {
    const { body } = await captureRequest()
    const messages = body.messages as { role: string, content: string }[]

    expect(messages.find(item => item.role === 'system')?.content).toBe(defaultClassifierSystemPrompt)
  })

  /**
   * A follow-up such as "那这个呢" is only a medical question because of the turn
   * before it, so the model has to see who said what. Without the labels an
   * assistant answer reads like the user's own complaint.
   */
  it('labels the earlier turns by speaker', async () => {
    let captured = ''
    const fetchSpy: typeof globalThis.fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { messages?: { role: string, content: string }[] }
      captured = body.messages?.find(item => item.role === 'user')?.content ?? ''
      return new Response(JSON.stringify(completion('{"decision":"chat","scene":"non-medical"}')), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }

    await classifyWithModel(
      {
        message: '那这个呢',
        history: [
          { role: 'user', content: '宝宝黄疸14，医生说观察' },
          { role: 'assistant', content: '建议明天复查' },
        ],
      },
      { ...options, request: { ...options.request, fetch: fetchSpy } },
    )

    expect(captured).toContain('【上文用户】宝宝黄疸14，医生说观察')
    expect(captured).toContain('【上文助手】建议明天复查')
    expect(captured).toContain('【当前用户消息】\n那这个呢')
  })
})
