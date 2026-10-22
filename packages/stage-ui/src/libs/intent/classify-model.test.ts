import { describe, expect, it } from 'vitest'

import { classifyWithModel, defaultClassifierSystemPrompt } from './classify-model'

/**
 * The model classifier is tested through the injected `fetch`, so an automated
 * run never reaches a provider and needs no API key.
 */

const options = {
  baseURL: 'https://provider.invalid/v1',
  apiKey: 'test-key',
  model: 'test-model',
}

function completion(content: string) {
  return {
    id: 'completion-1',
    object: 'chat.completion',
    created: 0,
    model: 'test-model',
    system_fingerprint: 'fp-test',
    choices: [
      {
        index: 0,
        finish_reason: 'stop',
        message: { role: 'assistant', content },
      },
    ],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  }
}

function respondWith(content: string): typeof globalThis.fetch {
  return async () => new Response(JSON.stringify(completion(content)), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

describe('classifyWithModel', () => {
  it('reads a plain JSON answer', async () => {
    const result = await classifyWithModel(
      { message: '宝宝黄疸怎么看' },
      {
        ...options,
        fetch: respondWith('{"decision":"medical","scene":"health-consultation","evidenceCodes":["model:symptom"]}'),
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
        ...options,
        fetch: respondWith('```json\n{"decision":"chat","scene":"non-medical","evidenceCodes":["model:smalltalk"]}\n```'),
      },
    )

    expect(result.decision).toBe('chat')
    expect(result.source).toBe('model')
  })

  it('degrades when the answer is not JSON', async () => {
    const result = await classifyWithModel(
      { message: '宝宝黄疸怎么看' },
      { ...options, fetch: respondWith('这不是 JSON') },
    )

    expect(result.source).toBe('fallback')
    expect(result.evidenceCodes).toEqual(['fallback:parse'])
  })

  it('degrades when a required field is not an allowed value', async () => {
    const result = await classifyWithModel(
      { message: '宝宝黄疸怎么看' },
      { ...options, fetch: respondWith('{"decision":"maybe","scene":"non-medical"}') },
    )

    expect(result.source).toBe('fallback')
    expect(result.evidenceCodes).toEqual(['fallback:parse'])
  })

  it('degrades when the answer carries an unknown evidence code', async () => {
    const result = await classifyWithModel(
      { message: '宝宝黄疸怎么看' },
      {
        ...options,
        fetch: respondWith('{"decision":"medical","scene":"health-consultation","evidenceCodes":["made_up_code"]}'),
      },
    )

    expect(result.source).toBe('fallback')
    expect(result.evidenceCodes).toEqual(['fallback:parse'])
  })

  it('degrades on a network failure', async () => {
    const result = await classifyWithModel(
      { message: '宝宝黄疸怎么看' },
      { ...options, fetch: async () => Promise.reject(new TypeError('fetch failed')) },
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
      { ...options, fetch: hangingFetch, timeoutMs: 20 },
    )

    expect(result.source).toBe('fallback')
    expect(result.evidenceCodes).toEqual(['fallback:timeout'])
  })

  it('does not call a provider it was not given', async () => {
    let called = false
    const fetchSpy: typeof globalThis.fetch = async () => {
      called = true
      return new Response('{}')
    }

    const result = await classifyWithModel(
      { message: '宝宝黄疸怎么看' },
      { baseURL: '', model: '', fetch: fetchSpy },
    )

    expect(called).toBe(false)
    expect(result.source).toBe('fallback')
    expect(result.evidenceCodes).toEqual(['fallback:not_configured'])
  })

  /**
   * The page lets a person edit the prompt, so what it sends is worth checking:
   * a silently ignored override would look like the edit changed nothing.
   */
  async function captureSystemPrompt(systemPrompt?: string): Promise<string> {
    let captured = ''
    const fetchSpy: typeof globalThis.fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { messages?: { role: string, content: string }[] }
      captured = body.messages?.find(item => item.role === 'system')?.content ?? ''
      return new Response(JSON.stringify(completion('{"decision":"chat","scene":"non-medical","evidenceCodes":["model:smalltalk"]}')), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }

    await classifyWithModel({ message: '你好' }, { ...options, fetch: fetchSpy, systemPrompt })
    return captured
  }

  it('sends the prompt it was given', async () => {
    expect(await captureSystemPrompt('自定义提示词')).toBe('自定义提示词')
  })

  it('falls back to the default prompt when none is given', async () => {
    expect(await captureSystemPrompt()).toBe(defaultClassifierSystemPrompt)
  })
})
