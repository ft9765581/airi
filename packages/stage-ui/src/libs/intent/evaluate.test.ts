import type { IntentSample } from './evaluate'

import { describe, expect, it } from 'vitest'

import { evaluateSamples } from './evaluate'
import { intentSampleGroupLabels, intentSamples } from './fixtures'

const options = {
  request: {
    baseURL: 'https://provider.invalid/v1',
    apiKey: 'test-key',
    model: 'test-model',
  },
}

/** A version the samples do not use, so carrying it through is visible. */
const setVersion = 7

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
    const report = await evaluateSamples({ samples: sampleSet, sampleSetVersion: setVersion, mode: 'rules' })

    expect(report.model).toBeUndefined()
    // Only `宝宝黄疸怎么看` carries a rule signal, so recall is 1 of 2.
    expect(report.rules.medicalRecall).toBeCloseTo(0.5)
    expect(report.rules.chatFalsePositiveRate).toBe(0)
    expect(report.rules.falseNegatives.map(item => item.sample.id)).toEqual(['b'])
    expect(report.unmatched.map(item => item.sample.id)).toEqual(['b'])
  })

  it('keeps the version of the labelled set it scored', async () => {
    const report = await evaluateSamples({ samples: sampleSet, sampleSetVersion: setVersion, mode: 'rules' })

    expect(report.sampleSetVersion).toBe(setVersion)
  })

  it('scores the model and reports its disagreements', async () => {
    const report = await evaluateSamples({
      samples: sampleSet,
      sampleSetVersion: setVersion,
      mode: 'compare',
      model: { ...options, request: { ...options.request, fetch: labelFetch(() => 'medical') } },
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

  /**
   * ROOT CAUSE:
   *
   * A side report used to fill `rules` and `model` of an error row from the same
   * decision, so "did the model fix this sample" could not be read off the row.
   *
   * Each row now carries the decision of each side.
   */
  it('keeps both decisions in an error row', async () => {
    const report = await evaluateSamples({
      samples: sampleSet,
      sampleSetVersion: setVersion,
      mode: 'compare',
      model: { ...options, request: { ...options.request, fetch: labelFetch(() => 'medical') } },
    })

    const missed = report.rules.falseNegatives[0]
    expect(missed.sample.id).toBe('b')
    expect(missed.rules.decision).toBe('chat')
    expect(missed.model?.decision).toBe('medical')
  })

  it('keeps both decisions when the model is the wrong side', async () => {
    const report = await evaluateSamples({
      samples: sampleSet,
      sampleSetVersion: setVersion,
      mode: 'compare',
      model: { ...options, request: { ...options.request, fetch: labelFetch(() => 'chat') } },
    })

    const missed = report.model?.falseNegatives[0]
    expect(missed?.sample.id).toBe('a')
    expect(missed?.rules.decision).toBe('medical')
    expect(missed?.model?.decision).toBe('chat')
  })

  /**
   * ROOT CAUSE:
   *
   * A failed classification returns `medical` so that routing fails safe. The
   * report used to score that label, so a provider that answered nothing showed
   * 100% medical recall and 100% chat false positives.
   *
   * A fallback is now a failure: it never counts as a hit, it stays in the
   * denominator, and it never makes the two sides "disagree".
   */
  it('scores a total model failure as failure rather than as an answer', async () => {
    const report = await evaluateSamples({
      samples: sampleSet,
      sampleSetVersion: setVersion,
      mode: 'model',
      model: { ...options, request: { ...options.request, fetch: async () => Promise.reject(new TypeError('fetch failed')) } },
    })

    expect(report.model?.fallbackRate).toBe(1)
    expect(report.model?.medicalRecall).toBe(0)
    expect(report.model?.chatFalsePositiveRate).toBe(0)
    expect(report.model?.falseNegatives.map(item => item.sample.id)).toEqual(['a', 'b'])
    expect(report.model?.falsePositives).toEqual([])
    expect(report.model?.failures).toHaveLength(3)
    expect(report.model?.failures[0].model?.evidenceCodes).toEqual(['fallback:network'])
  })

  it('does not let a failure look like a disagreement', async () => {
    const report = await evaluateSamples({
      samples: sampleSet,
      sampleSetVersion: setVersion,
      mode: 'compare',
      model: { ...options, request: { ...options.request, fetch: async () => Promise.reject(new TypeError('fetch failed')) } },
    })

    // The rules answer `c` with chat and the model degraded to medical, which is
    // not a second opinion.
    expect(report.disagreements).toEqual([])
    expect(report.unmatched.map(item => item.sample.id)).toEqual(['b'])
  })

  it('groups the samples so one slice cannot hide inside the average', async () => {
    const report = await evaluateSamples({
      samples: sampleSet,
      sampleSetVersion: setVersion,
      mode: 'model',
      model: { ...options, request: { ...options.request, fetch: async () => Promise.reject(new TypeError('fetch failed')) } },
    })

    expect(report.model?.groups.map(group => group.group).sort()).toEqual([
      'chitchat',
      'medical-explicit',
      'medical-implicit',
    ])
    const explicit = report.model?.groups.find(group => group.group === 'medical-explicit')
    expect(explicit?.total).toBe(1)
    expect(explicit?.medicalHits).toBe(0)
    expect(explicit?.failures).toBe(1)
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
