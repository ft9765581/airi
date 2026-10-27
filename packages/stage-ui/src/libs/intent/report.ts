import type { IntentSampleGroup } from './evaluate'

/**
 * The simple evaluation report.
 *
 * The page shows the numbers; this module turns them into one Markdown document
 * a person can paste into a pull request or hand to a reviewer. It is a pure
 * function so the wording of the conclusions — pass, fail, not enough samples —
 * can be tested without a browser.
 *
 * Thresholds come from the release gates in
 * `docs/medical-consultation-routing.md` §7. They are release targets, not
 * benchmarks: a report says which are met and which are not, and never rounds a
 * miss into a pass.
 */

/** One method's numbers, already computed by the caller. */
export interface ReportMethod {
  label: string
  /** Present when the method ran; a missing field means "not run". */
  recall?: number
  falsePositive?: number
  failure?: number
  uncertain?: number
  medicalTotal: number
  chatTotal: number
  durationMs?: number
}

/** What one report needs. */
export interface ReportInput {
  generatedAt: number
  sampleSetVersion: number
  sampleCount: number
  mode: string
  modelId?: string
  classifierPromptDigest?: string
  methods: ReportMethod[]
  /** Per-group hit counts, when the page has them. */
  groups?: { group: IntentSampleGroup, label: string, total: number, medicalHits: number, falsePositives: number }[]
  /** Rows where the methods that answered did not agree. */
  disagreements: { input: string, expected: 'medical' | 'chat', verdicts: string[] }[]
}

/** The release gates, in the order a reviewer reads them. */
export const releaseGates = {
  /** Minimum medical recall, as a share of every sample labelled medical. */
  minRecall: 0.95,
  /** Maximum false positives on samples labelled chat. */
  maxFalsePositive: 0.05,
  /** Maximum share of runs that produced no verdict at all. */
  maxFailure: 0.01,
  /** The validation set the gate is meant to be checked against. */
  minValidationSamples: 300,
} as const

/** A share a reader can compare with a gate; an unrun method says so. */
function share(value: number | undefined): string {
  return value === undefined ? '未运行' : `${(value * 100).toFixed(1)}%`
}

/** One gate cell: the number, and whether it clears the target. */
function gateCell(value: number | undefined, target: number, direction: 'at-least' | 'at-most'): string {
  if (value === undefined)
    return '未运行'

  const pass = direction === 'at-least' ? value >= target : value <= target

  return `${share(value)} ${pass ? '✅' : '❌'}`
}

/** The report's verdict on one method, in one sentence. */
function methodVerdict(method: ReportMethod): string {
  const misses: string[] = []

  if (method.recall !== undefined && method.recall < releaseGates.minRecall)
    misses.push(`医疗召回 ${share(method.recall)} < ${share(releaseGates.minRecall)}`)
  if (method.falsePositive !== undefined && method.falsePositive > releaseGates.maxFalsePositive)
    misses.push(`闲聊误判 ${share(method.falsePositive)} > ${share(releaseGates.maxFalsePositive)}`)
  if (method.failure !== undefined && method.failure > releaseGates.maxFailure)
    misses.push(`失败率 ${share(method.failure)} > ${share(releaseGates.maxFailure)}`)

  return misses.length ? `未达标：${misses.join('；')}` : '达标（P95 与人工审核另计）'
}

/**
 * Renders one evaluation as Markdown.
 *
 * @example
 * buildEvaluationMarkdown(input).split('\n')[0]
 * // => '# 意图识别评测报告'
 */
export function buildEvaluationMarkdown(input: ReportInput): string {
  const lines: string[] = []
  const long = (value: string | number | undefined) => (typeof value === 'number' ? value.toFixed(0) : value) ?? '未记录'

  lines.push('# 意图识别评测报告')
  lines.push('')
  lines.push(`- 生成时间：${new Date(input.generatedAt).toLocaleString()}`)
  lines.push(`- 样本集版本：v${input.sampleSetVersion}（${input.sampleCount} 条）`)
  lines.push(`- 运行模式：${input.mode}`)
  lines.push(`- 模型：${long(input.modelId)}`)
  lines.push(`- 分类提示词摘要：${long(input.classifierPromptDigest)}`)
  lines.push('')

  if (input.sampleCount < releaseGates.minValidationSamples) {
    lines.push(`> 样本数 ${input.sampleCount} 条，少于发布门槛要求的 ${releaseGates.minValidationSamples} 条未参与调优的验收集。本报告只作开发集诊断，不能作为上线依据。`)
    lines.push('')
  }

  lines.push('## 三方指标')
  lines.push('')
  lines.push('| 方法 | 医疗召回（≥95%） | 闲聊误判（≤5%） | 失败率（≤1%） | 不确定 | 分母 | 平均耗时 | 结论 |')
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- |')
  for (const method of input.methods) {
    lines.push([
      '',
      method.label,
      gateCell(method.recall, releaseGates.minRecall, 'at-least'),
      gateCell(method.falsePositive, releaseGates.maxFalsePositive, 'at-most'),
      gateCell(method.failure, releaseGates.maxFailure, 'at-most'),
      method.uncertain === undefined ? '—' : share(method.uncertain),
      `医疗 ${method.medicalTotal} / 闲聊 ${method.chatTotal}`,
      method.durationMs === undefined ? '未运行' : `${method.durationMs.toFixed(0)} ms`,
      methodVerdict(method),
      '',
    ].join(' | ').slice(1, -1))
  }
  lines.push('')

  if (input.groups?.length) {
    lines.push('## 分组')
    lines.push('')
    lines.push('| 分组 | 样本 | 医疗命中 | 闲聊误判 |')
    lines.push('| --- | --- | --- | --- |')
    for (const group of input.groups)
      lines.push(`| ${group.label} | ${group.total} | ${group.medicalHits} | ${group.falsePositives} |`)
    lines.push('')
  }

  lines.push('## 错例')
  lines.push('')
  lines.push(`三方不一致：${input.disagreements.length} 条`)
  for (const item of input.disagreements.slice(0, 10))
    lines.push(`- \`${item.expected === 'medical' ? '医疗' : '闲聊'}\` ${item.input} → ${item.verdicts.join(' / ')}`)
  if (input.disagreements.length > 10)
    lines.push(`- …另有 ${input.disagreements.length - 10} 条`)
  lines.push('')

  const failing = input.methods.filter(method => !methodVerdict(method).startsWith('达标'))
  lines.push('## 结论')
  lines.push('')
  if (!failing.length) {
    lines.push('三种方法在当前样本集上均达到门槛数字。仍需独立验收集复测、P95 耗时与医疗回答人工审核，才可把部署开关从 `dev` 改为 `on`。')
  }
  else {
    lines.push(`未达标：${failing.map(method => method.label).join('、')}。按设计保持固定医疗回复，不开启医疗生成。`)
  }
  lines.push('')
  lines.push('> 报告只使用合成或脱敏样本；不含用户原始医疗消息与密钥。')
  lines.push('')

  return lines.join('\n')
}
