import { chatFormatConstraints } from '../../constants/prompts/chat-format'

/**
 * The system message of one medical consultation turn.
 *
 * The text has two owners. The application owns the behaviour rules, because a
 * character card can arrive from outside this deployment and must not be able to
 * remove them. The card owns tone, wording and subject.
 *
 * Assembly order is fixed: shared format constraints, behaviour rules, card
 * persona. A card that writes "you are a doctor, give the dose" therefore reads
 * as a request to override, and the constraints above it still win.
 */

/**
 * Behaviour rules every medical answer follows.
 *
 * The card cannot change, extend or remove this text. Each line is a rule the
 * product must keep, so edit it here and not in a character card.
 */
export const medicalBehaviorConstraints = [
  '医疗咨询的行为约束（应用维护，角色卡不能覆盖）：',
  '- 你是医疗咨询助手，不是执业医生。不能声称已经诊断，也不能保证安全。',
  '- 先回应对方的问题，再补充必要说明。',
  '- 信息不足时只问最关键的一到两个补充问题，不要一次列出一长串。',
  '- 可以解释一般知识、护理要点和建议就医时机。',
  '- 不给出具体用药剂量、处方，也不代替医生做判断。',
  '- 不编造检查结果、化验数值或诊断结论。',
  '- 遇到大量出血、意识不清、呼吸困难、抽搐这类急症信号，直接建议立即就医或拨打 120。',
  '- 保持简短，不要每条都重复同一段免责声明。',
].join('\n')

/** Everything one medical system message is built from. */
export interface MedicalPromptInput {
  /** The card's `agents.medical.prompt`. */
  persona: string
  /**
   * Replaces the shared format constraints.
   *
   * @default chatFormatConstraints
   */
  formatConstraints?: string
}

/**
 * Builds the system message of one medical turn.
 *
 * A blank part contributes nothing, so a card with no persona text still gets
 * the constraints and the session stays free of stray blank lines.
 *
 * @example
 * composeMedicalSystemPrompt({ persona: '你是产康顾问，说话简短。' })
 * // => '…format constraints…\n\n…behaviour rules…\n\n你是产康顾问，说话简短。'
 */
export function composeMedicalSystemPrompt(input: MedicalPromptInput): string {
  const parts = [
    input.formatConstraints ?? chatFormatConstraints,
    medicalBehaviorConstraints,
    input.persona,
  ]

  return parts
    .map(part => part.trim())
    .filter(part => part.length > 0)
    .join('\n\n')
}

/** FNV-1a over UTF-16 code units. Same input, same digest, no dependency. */
function digestOf(value: string): string {
  let hash = 0x811C9DC5
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }

  return (hash >>> 0).toString(16).padStart(8, '0')
}

/**
 * A short digest of one prompt, for the routing record.
 *
 * The record keeps this instead of the text: a stored report, a log line or a
 * devtools table cannot leak a card's persona, and two runs can still be told
 * apart.
 *
 * @example
 * summarizePrompt('你是产康顾问')
 * // => 'fc47d612:6'
 */
export function summarizePrompt(prompt: string): string {
  return `${digestOf(prompt)}:${prompt.length}`
}
