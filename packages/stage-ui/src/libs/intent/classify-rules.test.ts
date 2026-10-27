import { describe, expect, it } from 'vitest'

import { classifyRules, inheritedRedFlag } from './classify-rules'
import { classifierVersion } from './contract'

describe('classifyRules', () => {
  it.each([
    // A medical term answers with the medical decision and names the signal.
    ['宝宝黄疸怎么看', 'medical', 'health-consultation', ['medical_term']],
    ['我今天恶露比昨天多', 'medical', 'health-consultation', ['medical_term']],
    // A danger signal is reported apart from a plain term, because the gate
    // answers it with a different line.
    ['出血很多怎么办', 'medical', 'health-consultation', ['red_flag']],
    ['宝宝不哭不动', 'medical', 'health-consultation', ['red_flag']],
    // A physiological value needs no word from the list. The unit is what
    // makes it a value: `体温38.5` without one is caught by the term 体温.
    ['体温 38.5 度', 'medical', 'health-consultation', ['vital_value']],
    ['血压 120/80', 'medical', 'health-consultation', ['vital_value']],
    // A person word alone carries no medical meaning.
    ['宝宝今天特别乖', 'chat', 'non-medical', ['no_signal']],
    ['她今天特别没精神', 'chat', 'non-medical', ['no_signal']],
    ['今天天气不错', 'chat', 'non-medical', ['no_signal']],
    // Acknowledgements and empty input carry no question.
    ['好的', 'chat', 'non-medical', ['ack']],
    ['OK', 'chat', 'non-medical', ['ack']],
    ['', 'chat', 'non-medical', ['empty']],
    ['   ', 'chat', 'non-medical', ['empty']],
  ])('classifies %j', (message, decision, scene, evidenceCodes) => {
    const result = classifyRules(message)

    expect(result.decision).toBe(decision)
    expect(result.scene).toBe(scene)
    expect(result.evidenceCodes).toEqual(evidenceCodes)
  })

  it('reports a stable rule result', () => {
    const result = classifyRules('宝宝黄疸怎么看')

    expect(result.source).toBe('rule')
    expect(result.classifierVersion).toBe(classifierVersion)
  })
})

describe('inheritedRedFlag', () => {
  const bleeding = '大量出血，头晕'

  it('inherits a danger signal the follow-up says is still happening', () => {
    const result = inheritedRedFlag('现在还是这样', bleeding)

    expect(result?.decision).toBe('medical')
    expect(result?.evidenceCodes).toEqual(['red_flag_inherited'])
  })

  it('does not inherit when the reader closed the topic', () => {
    expect(inheritedRedFlag('晚安', bleeding)).toBeUndefined()
    expect(inheritedRedFlag('谢谢，不聊了', bleeding)).toBeUndefined()
  })

  it('does not inherit when the previous turn carried no danger signal', () => {
    expect(inheritedRedFlag('现在还是这样', '宝宝黄疸怎么看')).toBeUndefined()
  })

  it('does not inherit a symptom the reader reports as resolved', () => {
    expect(inheritedRedFlag('已经不出血了', bleeding)).toBeUndefined()
  })

  it('leaves a message that names its own danger word to classifyRules', () => {
    // A fresh signal is reported as `red_flag`, not as an inherited one.
    expect(inheritedRedFlag('现在又开始大量出血', bleeding)).toBeUndefined()
    expect(classifyRules('现在又开始大量出血').evidenceCodes).toEqual(['red_flag'])
  })

  it('does nothing without a previous turn', () => {
    expect(inheritedRedFlag('现在还是这样', undefined)).toBeUndefined()
  })

  it('over-triggers on purpose when the marker is present', () => {
    // The rule reads the continuation marker and nothing else. Over-triggering
    // costs one unnecessary emergency line; under-triggering hides a continuing
    // haemorrhage. This case records the trade-off, so a later change has to say
    // which way it moved it.
    expect(inheritedRedFlag('还是不要去了', bleeding)?.evidenceCodes).toEqual(['red_flag_inherited'])
  })
})
