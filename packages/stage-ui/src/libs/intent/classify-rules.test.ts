import { describe, expect, it } from 'vitest'

import { classifyRules } from './classify-rules'
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
