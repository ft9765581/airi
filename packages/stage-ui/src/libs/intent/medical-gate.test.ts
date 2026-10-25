import { describe, expect, it } from 'vitest'

import { classifyRules } from './classify-rules'
import { medicalGateReply, medicalGateReplyFor, medicalGateUrgentReply } from './medical-gate'

describe('medicalGateReplyFor', () => {
  it.each([
    // A medical term returns the fixed reply, so the send never reaches the model.
    ['宝宝黄疸怎么看', medicalGateReply],
    ['我今天恶露比昨天多', medicalGateReply],
    ['乳房胀痛还能喂奶吗', medicalGateReply],
    // A physiological value returns the same reply, because the unit alone is
    // enough to place the message in a medical context.
    ['体温38.5', medicalGateReply],
    ['血压 120/80', medicalGateReply],
    // A symptom that needs care today gets its own reply.
    ['出血很多怎么办', medicalGateUrgentReply],
    ['宝宝不哭不动', medicalGateUrgentReply],
    // A person word alone carries no medical meaning.
    ['宝宝今天特别乖', null],
    ['她今天特别没精神', null],
    ['今天天气不错', null],
    // Acknowledgements and empty messages carry no question at all.
    ['好的', null],
    ['嗯', null],
    ['OK', null],
    ['', null],
    ['   ', null],
  ])('maps the decision for %j', (message, expected) => {
    expect(medicalGateReplyFor(classifyRules(message))).toBe(expected)
  })

  it('keeps the urgent reply distinct from the default one', () => {
    // Both replies exist so a dangerous symptom never hears "I cannot answer".
    expect(medicalGateUrgentReply).not.toBe(medicalGateReply)
  })
})
