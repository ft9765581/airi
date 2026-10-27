import { describe, expect, it } from 'vitest'

import { buildEvaluationMarkdown, releaseGates } from './report'

const baseInput = {
  generatedAt: new Date('2026-10-26T12:00:00Z').getTime(),
  sampleSetVersion: 7,
  sampleCount: 400,
  mode: 'compare',
  modelId: 'deepseek-flash',
  classifierPromptDigest: 'abc12345:120',
  methods: [
    { label: '规则', recall: 0.446, falsePositive: 0.056, failure: 0, medicalTotal: 200, chatTotal: 200, durationMs: 1 },
  ],
  disagreements: [],
}

describe('buildEvaluationMarkdown', () => {
  it('renders the three-way table with denominators and gate cells', () => {
    const markdown = buildEvaluationMarkdown({
      ...baseInput,
      methods: [
        ...baseInput.methods,
        { label: '生成式模型', recall: 0.96, falsePositive: 0.04, failure: 0.005, medicalTotal: 200, chatTotal: 200, durationMs: 730 },
        { label: 'Embedding', recall: 0.93, falsePositive: 0.03, failure: 0.01, uncertain: 0.05, medicalTotal: 200, chatTotal: 200, durationMs: 120 },
      ],
    })

    expect(markdown).toContain('# 意图识别评测报告')
    // Reads the denominator, not only the percentage.
    expect(markdown).toContain('医疗 200 / 闲聊 200')
    // A miss and a pass are both visible next to the gate.
    expect(markdown).toContain('44.6% ❌')
    expect(markdown).toContain('96.0% ✅')
    expect(markdown).toContain('不确定')
  })

  it('says a method did not run instead of scoring it zero', () => {
    const markdown = buildEvaluationMarkdown({
      ...baseInput,
      methods: [{ label: 'Embedding', medicalTotal: 200, chatTotal: 200 }],
    })

    expect(markdown).toContain('未运行')
    expect(markdown).not.toContain('0.0% ✅')
  })

  it('warns when the set is smaller than the release validation set', () => {
    const markdown = buildEvaluationMarkdown({ ...baseInput, sampleCount: releaseGates.minValidationSamples - 1 })

    expect(markdown).toContain('少于发布门槛要求')
    expect(markdown).toContain('不能作为上线依据')

    const enough = buildEvaluationMarkdown({ ...baseInput, sampleCount: releaseGates.minValidationSamples })
    expect(enough).not.toContain('少于发布门槛要求')
  })

  it('keeps the emergency instruction when a gate is missed', () => {
    const markdown = buildEvaluationMarkdown(baseInput)

    expect(markdown).toContain('未达标：规则')
    expect(markdown).toContain('保持固定医疗回复')
  })

  it('passes only when every gate number is met, and still asks for the rest', () => {
    const markdown = buildEvaluationMarkdown({
      ...baseInput,
      methods: [
        { label: '生成式模型', recall: 0.97, falsePositive: 0.02, failure: 0.002, medicalTotal: 200, chatTotal: 200, durationMs: 700 },
      ],
    })

    expect(markdown).toContain('均达到门槛数字')
    expect(markdown).toContain('独立验收集')
    expect(markdown).toContain('人工审核')
  })

  it('treats the gate boundaries as passing', () => {
    const markdown = buildEvaluationMarkdown({
      ...baseInput,
      methods: [{
        label: '边界',
        recall: releaseGates.minRecall,
        falsePositive: releaseGates.maxFalsePositive,
        failure: releaseGates.maxFailure,
        medicalTotal: 200,
        chatTotal: 200,
        durationMs: 1,
      }],
    })

    expect(markdown).toContain('达标（P95 与人工审核另计）')
  })

  it('lists disagreements with a cap so a long report stays readable', () => {
    const disagreements = Array.from({ length: 12 }, (_, index) => ({
      input: `样本 ${index}`,
      expected: 'medical' as const,
      verdicts: ['医学', '闲聊', '未运行'],
    }))

    const markdown = buildEvaluationMarkdown({ ...baseInput, disagreements })

    expect(markdown).toContain('三方不一致：12 条')
    expect(markdown).toContain('样本 0')
    expect(markdown).toContain('另有 2 条')
  })

  it('states that the report holds no raw medical text or keys', () => {
    expect(buildEvaluationMarkdown(baseInput)).toContain('不含用户原始医疗消息与密钥')
  })
})
