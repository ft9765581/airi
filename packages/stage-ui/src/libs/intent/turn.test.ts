import type { IntentDecision } from './contract'

import { describe, expect, it, vi } from 'vitest'

import { classifyRules } from './classify-rules'
import { medicalGateReply, medicalGateUrgentReply } from './medical-gate'
import { medicalBehaviorConstraints } from './medical-prompt'
import { failedTurnReply, routeMedicalTurn } from './turn'

/** One model classifier result, with only the fields routing reads. */
function decision(label: 'medical' | 'chat', source: 'rule' | 'model' | 'fallback' = 'model', codes: IntentDecision['evidenceCodes'] = []): IntentDecision {
  return {
    decision: label,
    scene: label === 'medical' ? 'health-consultation' : 'non-medical',
    evidenceCodes: codes,
    source,
    classifierVersion: 3,
  }
}

const usableAgent = { enabled: true, prompt: '你是产康顾问，说话简短。' }

describe('routeMedicalTurn with the deployment switch off', () => {
  it('answers a medical message with fixed copy and no classifier call', async () => {
    const classify = vi.fn(async () => decision('medical'))

    const result = await routeMedicalTurn({
      rules: classifyRules('宝宝黄疸怎么看'),
      classify,
      agent: usableAgent,
      allowGeneration: false,
    })

    expect(result.route).toEqual({ kind: 'medical', reason: 'deployment_disabled' })
    expect(result.reply).toBe(medicalGateReply)
    expect(result.systemPrompt).toBeUndefined()
    expect(classify).not.toHaveBeenCalled()
  })

  it('keeps the emergency copy ahead of the fixed copy', async () => {
    const result = await routeMedicalTurn({
      rules: classifyRules('大量出血，头晕'),
      classify: async () => decision('chat'),
      agent: usableAgent,
      allowGeneration: false,
    })

    expect(result.route).toEqual({ kind: 'urgent', reason: 'red_flag' })
    expect(result.reply).toBe(medicalGateUrgentReply)
  })

  it('leaves a chat message on the chat branch', async () => {
    const result = await routeMedicalTurn({
      rules: classifyRules('今天天气不错'),
      classify: async () => decision('medical'),
      agent: usableAgent,
      allowGeneration: false,
    })

    expect(result.route).toEqual({ kind: 'chat' })
    expect(result.reply).toBeUndefined()
  })
})

describe('failedTurnReply', () => {
  it('gives a failed medical generation the fixed reply', () => {
    expect(failedTurnReply({ kind: 'medical' })).toBe(medicalGateReply)
  })

  it('leaves every other branch to the error path', () => {
    expect(failedTurnReply({ kind: 'chat' })).toBeUndefined()
    expect(failedTurnReply({ kind: 'urgent' })).toBeUndefined()
    expect(failedTurnReply(undefined)).toBeUndefined()
  })
})

describe('routeMedicalTurn with generation allowed', () => {
  it('writes the emergency copy without asking the classifier', async () => {
    const classify = vi.fn(async () => decision('chat'))

    const result = await routeMedicalTurn({
      rules: classifyRules('大量出血，头晕'),
      classify,
      agent: usableAgent,
      allowGeneration: true,
    })

    expect(result.route).toEqual({ kind: 'urgent', reason: 'red_flag' })
    expect(result.reply).toBe(medicalGateUrgentReply)
    expect(classify).not.toHaveBeenCalled()
  })

  it('runs the consultation model with an isolated prompt when the card opted in', async () => {
    const result = await routeMedicalTurn({
      rules: classifyRules('宝宝黄疸怎么看'),
      classify: async () => decision('medical'),
      agent: usableAgent,
      allowGeneration: true,
    })

    expect(result.route).toEqual({ kind: 'medical' })
    expect(result.reply).toBeUndefined()
    expect(result.isolate).toBe(true)
    expect(result.systemPrompt).toContain(medicalBehaviorConstraints)
    expect(result.systemPrompt).toContain('你是产康顾问，说话简短。')
  })

  it('keeps the fixed reply when the card has no usable agent', async () => {
    const result = await routeMedicalTurn({
      rules: classifyRules('宝宝黄疸怎么看'),
      classify: async () => decision('medical'),
      agent: { enabled: false, prompt: '你是产康顾问。' },
      allowGeneration: true,
    })

    expect(result.route).toEqual({ kind: 'medical', reason: 'agent_disabled' })
    expect(result.reply).toBe(medicalGateReply)
    expect(result.systemPrompt).toBeUndefined()
  })

  it('answers a degraded classifier with safe copy instead of medical generation', async () => {
    const result = await routeMedicalTurn({
      rules: classifyRules('我有点不放心'),
      classify: async () => decision('medical', 'fallback', ['fallback:timeout']),
      agent: usableAgent,
      allowGeneration: true,
    })

    expect(result.route).toEqual({ kind: 'fallback', reason: 'fallback:timeout' })
    expect(result.reply).toBe(medicalGateReply)
    expect(result.systemPrompt).toBeUndefined()
  })

  it('leaves a chat answer on the chat branch even when the rules matched a term', async () => {
    const result = await routeMedicalTurn({
      rules: classifyRules('体温37.8'),
      classify: async () => decision('chat'),
      agent: usableAgent,
      allowGeneration: true,
    })

    expect(result.route).toEqual({ kind: 'chat' })
    expect(result.reply).toBeUndefined()
  })
})
