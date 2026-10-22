import type { IntentSample } from './evaluate'

import { describe, expect, it } from 'vitest'

import { evaluateSamples } from './evaluate'
import { intentSampleGroupLabels, intentSamples } from './fixtures'

const options = {
  baseURL: 'https://provider.invalid/v1',
  apiKey: 'test-key',
  model: 'test-model',
}

/** Repeats the labels a test wants, so metrics are arithmetic, not luck. */
function labelFetch(labelFor: (text: string) => 'medical' | 'chat'): typeof globalThis.fetch {
  return async (_input, init) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as { messages?: { role: string, content: string }[] }
    const userMessage = [...(body.messages ?? [])].reverse().find(item => item.role === 'user')
    const decision = labelFor(String(userMessage?.content ?? ''))

    return new Response(JSON.stringify({
      id: 'completion-1',
      object: 'chat.completion',
      created: 0,
      model: 'test-model',
      system_fingerprint: 'fp-test',
      choices: [{
        index: 0,
        finish_reason: 'stop',
        message: {
          role: 'assistant',
          content: JSON.stringify({
            decision,
            scene: decision === 'medical' ? 'health-consultation' : 'non-medical',
            evidenceCodes: [decision === 'medical' ? 'model:symptom' : 'model:smalltalk'],
          }),
        },
      }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
}

const sampleSet: IntentSample[] = [
  { id: 'a', group: 'medical-explicit', expected: 'medical', input: '宝宝黄疸怎么看' },
  { id: 'b', group: 'medical-implicit', expected: 'medical', input: '她今天特别没精神' },
  { id: 'c', group: 'chitchat', expected: 'chat', input: '今天天气不错' },
]

describe('evaluateSamples', () => {
  it('scores the rules without touching the model', async () => {
    const report = await evaluateSamples({ samples: sampleSet, mode: 'rules' })

    expect(report.model).toBeUndefined()
    // Only `宝宝黄疸怎么看` carries a rule signal, so recall is 1 of 2.
    expect(report.rules.medicalRecall).toBeCloseTo(0.5)
    expect(report.rules.chatFalsePositiveRate).toBe(0)
    expect(report.rules.falseNegatives.map(item => item.sample.id)).toEqual(['b'])
    expect(report.unmatched.map(item => item.sample.id)).toEqual(['b'])
  })

  it('scores the model and reports its disagreements', async () => {
    const report = await evaluateSamples({
      samples: sampleSet,
      mode: 'compare',
      model: { ...options, fetch: labelFetch(() => 'medical') },
    })

    expect(report.model?.medicalRecall).toBe(1)
    // Every chat sample was called medical, so the false positive rate is 1.
    expect(report.model?.chatFalsePositiveRate).toBe(1)
    expect(report.model?.falsePositives.map(item => item.sample.id)).toEqual(['c'])
    expect(report.disagreements.map(item => item.sample.id)).toEqual(['b', 'c'])
    // Between the two sides every sample is matched: the model fixes `b` and
    // only the rules answer `c` correctly.
    expect(report.unmatched).toEqual([])
  })

  it('scores a total model failure as fallback rather than as an answer', async () => {
    const report = await evaluateSamples({
      samples: sampleSet,
      mode: 'model',
      model: { ...options, fetch: async () => Promise.reject(new TypeError('fetch failed')) },
    })

    expect(report.model?.fallbackRate).toBe(1)
    // Every failure degrades to medical, so the chat sample shows as a false positive.
    expect(report.model?.chatFalsePositiveRate).toBe(1)
  })

  it('groups the samples so one slice cannot hide inside the average', async () => {
    const report = await evaluateSamples({ samples: sampleSet, mode: 'rules' })

    expect(report.rules.groups.map(group => group.group).sort()).toEqual([
      'chitchat',
      'medical-explicit',
      'medical-implicit',
    ])
    const explicit = report.rules.groups.find(group => group.group === 'medical-explicit')
    expect(explicit?.medicalHits).toBe(1)
    expect(explicit?.total).toBe(1)
  })
})

describe('intentSamples', () => {
  it('covers every group with a label', () => {
    const groups = new Set(intentSamples.map(sample => sample.group))

    expect(groups.size).toBe(Object.keys(intentSampleGroupLabels).length)
    for (const sample of intentSamples) {
      expect(sample.expected === 'medical' || sample.expected === 'chat').toBe(true)
      expect(sample.input.trim()).not.toBe('')
    }
  })

  it('keeps an id unique for every sample', () => {
    expect(new Set(intentSamples.map(sample => sample.id)).size).toBe(intentSamples.length)
  })

  it('holds both labels with room for a real mistake', () => {
    const medical = intentSamples.filter(sample => sample.expected === 'medical').length

    expect(intentSamples.length).toBeGreaterThanOrEqual(60)
    expect(medical).toBeGreaterThan(10)
    expect(intentSamples.length - medical).toBeGreaterThan(10)
  })
})
