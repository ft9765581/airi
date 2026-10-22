import { describe, expect, it } from 'vitest'

import { classifyMessage } from './classify'

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
    choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content } }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  }
}

function respondWith(content: string): typeof globalThis.fetch {
  return async () => new Response(JSON.stringify(completion(content)), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

describe('classifyMessage', () => {
  it('answers with rules only when the mode is rules', async () => {
    const result = await classifyMessage({ message: '宝宝黄疸怎么看', mode: 'rules' })

    expect(result.mode).toBe('rules')
    if (result.mode !== 'rules')
      throw new Error('unreachable')
    expect(result.decision.source).toBe('rule')
    expect(result.decision.decision).toBe('medical')
  })

  it('answers with the model only when the mode is model', async () => {
    const result = await classifyMessage({
      message: '宝宝黄疸怎么看',
      mode: 'model',
      model: {
        ...options,
        fetch: respondWith('{"decision":"medical","scene":"health-consultation","evidenceCodes":["model:symptom"]}'),
      },
    })

    expect(result.mode).toBe('model')
    if (result.mode !== 'model')
      throw new Error('unreachable')
    expect(result.decision.source).toBe('model')
  })

  it('degrades without a provider in model mode', async () => {
    const result = await classifyMessage({ message: '宝宝黄疸怎么看', mode: 'model' })

    if (result.mode !== 'model')
      throw new Error('unreachable')
    expect(result.decision.source).toBe('fallback')
    expect(result.decision.evidenceCodes).toEqual(['fallback:not_configured'])
  })

  it('reports agreement in compare mode', async () => {
    const result = await classifyMessage({
      message: '宝宝黄疸怎么看',
      mode: 'compare',
      model: {
        ...options,
        fetch: respondWith('{"decision":"medical","scene":"health-consultation","evidenceCodes":["model:symptom"]}'),
      },
    })

    if (result.mode !== 'compare')
      throw new Error('unreachable')
    expect(result.comparison.rules.decision).toBe('medical')
    expect(result.comparison.model.decision).toBe('medical')
    expect(result.comparison.sameDecision).toBe(true)
    expect(result.comparison.durationMs.rules).toBeGreaterThanOrEqual(0)
    expect(result.comparison.durationMs.model).toBeGreaterThanOrEqual(0)
  })

  it('reports a disagreement in compare mode', async () => {
    // The rule classifier has no signal for this sentence, so a model that
    // calls it medical is exactly the disagreement the page must show.
    const result = await classifyMessage({
      message: '她今天特别没精神',
      mode: 'compare',
      model: {
        ...options,
        fetch: respondWith('{"decision":"medical","scene":"health-consultation","evidenceCodes":["model:symptom"]}'),
      },
    })

    if (result.mode !== 'compare')
      throw new Error('unreachable')
    expect(result.comparison.rules.decision).toBe('chat')
    expect(result.comparison.model.decision).toBe('medical')
    expect(result.comparison.sameDecision).toBe(false)
  })
})
