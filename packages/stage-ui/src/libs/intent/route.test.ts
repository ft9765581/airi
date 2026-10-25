import type { IntentDecision } from './contract'

import { describe, expect, it } from 'vitest'

import { resolveTurnRoute } from './route'

/** One classifier result, with only the fields the router reads. */
function decision(label: 'medical' | 'chat', source: 'rule' | 'model' | 'fallback' = 'model', codes: IntentDecision['evidenceCodes'] = []): IntentDecision {
  return {
    decision: label,
    scene: label === 'medical' ? 'health-consultation' : 'non-medical',
    evidenceCodes: codes,
    source,
    classifierVersion: 3,
  }
}

const usableAgent = { enabled: true, prompt: '你是产康顾问。' }

describe('resolveTurnRoute', () => {
  it('routes a medical answer to the consultation model when the card has an agent', () => {
    const result = resolveTurnRoute({
      rules: decision('chat', 'rule', ['no_signal']),
      decision: decision('medical'),
      agent: usableAgent,
    })

    expect(result.route).toEqual({ kind: 'medical' })
    expect(result.useAgent).toBe(true)
  })

  it('lets a danger signal win over every classifier answer', () => {
    const result = resolveTurnRoute({
      rules: decision('medical', 'rule', ['red_flag']),
      decision: decision('chat'),
      agent: usableAgent,
    })

    expect(result.route).toEqual({ kind: 'urgent', reason: 'red_flag' })
    expect(result.useAgent).toBe(false)
  })

  // ROOT CAUSE:
  //
  // The fixed gate used the rule classifier for everything, and the model
  // classifier degrades to `medical` when it fails. Routing on that label made a
  // broken provider look like a medical question.
  //
  // A degraded answer is now its own branch, and a medical word the rules
  // matched does not promote it.
  it('keeps a degraded classifier answer on the fallback branch', () => {
    const result = resolveTurnRoute({
      rules: decision('medical', 'rule', ['medical_term']),
      decision: decision('medical', 'fallback', ['fallback:timeout']),
      agent: usableAgent,
    })

    expect(result.route).toEqual({ kind: 'fallback', reason: 'fallback:timeout' })
    expect(result.useAgent).toBe(false)
  })

  it('does not route a chat answer as medical because the rules matched a term', () => {
    const result = resolveTurnRoute({
      rules: decision('medical', 'rule', ['medical_term']),
      decision: decision('chat'),
      agent: usableAgent,
    })

    expect(result.route).toEqual({ kind: 'chat' })
    expect(result.useAgent).toBe(false)
  })

  it.each([
    ['agent_missing', undefined],
    ['agent_disabled', { enabled: false, prompt: '你是产康顾问。' }],
    ['prompt_empty', { enabled: true, prompt: '   ' }],
  ] as const)('keeps the fixed reply when the agent is %s', (problem, agent) => {
    const result = resolveTurnRoute({
      rules: decision('chat', 'rule', ['no_signal']),
      decision: decision('medical'),
      agent,
    })

    expect(result.route).toEqual({ kind: 'medical', reason: problem })
    expect(result.useAgent).toBe(false)
  })

  it('treats a missing enabled flag as disabled', () => {
    // An older card can carry a prompt without ever opting in.
    const result = resolveTurnRoute({
      rules: decision('chat', 'rule', ['no_signal']),
      decision: decision('medical'),
      agent: { prompt: '你是产康顾问。' },
    })

    expect(result.route).toEqual({ kind: 'medical', reason: 'agent_disabled' })
    expect(result.useAgent).toBe(false)
  })
})
