import type { IntentDecision, IntentEvidenceCode, IntentScene } from './contract'

import { classifierVersion } from './contract'

/**
 * The rule classifier: the phase-one gate, now returning a decision object.
 *
 * The matching order and the word lists are unchanged from the phase-one gate.
 * Only the return shape moved, so a caller can tell which signal fired without
 * reading the reply text.
 */

/** Whole-message replies that carry no question. */
const acknowledgementWords = new Set([
  '好的',
  '好的吧',
  '好的呀',
  '知道了',
  '明白了',
  '收到',
  '了解',
  '嗯',
  '恩',
  '行',
  'ok',
  'okay',
])

/** Symptoms that need care today. */
export const redFlagWords = [
  '大量出血',
  '出血很多',
  '血流不止',
  '大出血',
  '抽搐',
  '昏迷',
  '意识不清',
  '叫不醒',
  '呼吸困难',
  '喘不上气',
  '不哭不动',
  '高烧不退',
  '剧烈腹痛',
  '头晕乏力',
  '自杀',
  '自伤',
]

/**
 * Words that say the previous symptom is still happening.
 *
 * Inheritance needs the previous user message to carry a danger signal and this
 * message to say it persists. The marker is the only evidence this rule reads,
 * so it errs towards the emergency: "还是不要去了" after a bleeding report
 * inherits the alarm even though it describes no symptom. One unnecessary
 * emergency line is the safe direction; missing a continuing haemorrhage is not.
 * The list needs review against real conversations.
 */
export const continuingSymptomWords = [
  '还是',
  '还在',
  '一直',
  '仍然',
  '持续',
  '没停',
  '止不住',
  '不止',
  '越来越',
  '更严重',
  '加重',
  '没好转',
  '不见好',
]

/**
 * Words that close the topic instead of continuing it.
 *
 * A goodnight after an emergency must not inherit the emergency. Re-raising an
 * alarm the reader already put down teaches them to ignore the next one.
 */
const topicEndWords = [
  '晚安',
  '睡了',
  '睡觉了',
  '再见',
  '拜拜',
  '谢谢',
  '不用了',
  '不聊了',
  '没事了',
  '好了',
]

/** Medical terms for the mother, the newborn and hospital care. */
const medicalWords = [
  // 产妇
  '恶露',
  '伤口',
  '缝线',
  '侧切',
  '剖宫产',
  '乳房',
  '胀奶',
  '堵奶',
  '乳腺炎',
  '便秘',
  '腰痛',
  '盆底',
  '漏尿',
  '掉头发',
  '体温',
  '血压',
  '发烧',
  '发热',
  '出血',
  '腹痛',
  '头晕',
  '贫血',
  // 新生儿
  '黄疸',
  '脐带',
  '肚脐',
  '吃奶',
  '喂养',
  '母乳',
  '吐奶',
  '溢奶',
  '大便',
  '小便',
  '哭声',
  '呼吸',
  '体重',
  '湿疹',
  '红屁股',
  '疫苗',
  // 医疗行为
  '吃药',
  '用药',
  '剂量',
  '复查',
  '就诊',
  '挂号',
  '医嘱',
  '化验',
  '指标',
]

/**
 * Physiological measurements written with a unit.
 *
 * Small talk does not carry these, so a match here is close to free of false
 * positives. Units without medical meaning, such as `天` or `岁`, stay out on
 * purpose.
 */
const vitalValuePattern = /\d+(?:\.\d+)?\s*(?:[℃度次]|毫升|ml|mL)|血氧|\d{2,3}\s*\/\s*\d{2,3}/

function decision(
  label: 'medical' | 'chat',
  scene: IntentScene,
  codes: IntentEvidenceCode[],
): IntentDecision {
  return {
    decision: label,
    scene,
    evidenceCodes: codes,
    source: 'rule',
    classifierVersion,
  }
}

/**
 * Classifies one message with rules only.
 *
 * @example
 * classifyRules('宝宝黄疸怎么看').decision
 * // => 'medical'
 * @example
 * classifyRules('宝宝今天特别乖').decision
 * // => 'chat'
 */
export function classifyRules(message: string): IntentDecision {
  const text = message.trim()

  if (!text)
    return decision('chat', 'non-medical', ['empty'])

  // A bare acknowledgement carries no question, so it stays in small talk.
  if (acknowledgementWords.has(text.toLowerCase()))
    return decision('chat', 'non-medical', ['ack'])

  if (redFlagWords.some(word => text.includes(word)))
    return decision('medical', 'health-consultation', ['red_flag'])

  if (vitalValuePattern.test(text))
    return decision('medical', 'health-consultation', ['vital_value'])

  // Person words such as `宝宝` are not in the term list: alone they say
  // nothing medical, and treating them as a match turns almost every message
  // into a medical one.
  if (medicalWords.some(word => text.includes(word)))
    return decision('medical', 'health-consultation', ['medical_term'])

  return decision('chat', 'non-medical', ['no_signal'])
}

/**
 * Re-reads the previous turn's danger signal when this message says it persists.
 *
 * A reader who wrote "大量出血" and then "现在还是这样" asked one question across
 * two messages. Judged alone, the second message carries no danger word, so the
 * reader would get a consultation answer instead of the emergency instruction.
 * Only the immediately preceding user message counts: an alarm from older
 * history was already answered and must not keep firing.
 *
 * @example
 * inheritedRedFlag('现在还是这样', '大量出血，头晕')?.evidenceCodes
 * // => ['red_flag_inherited']
 * @example
 * inheritedRedFlag('晚安', '大量出血，头晕')
 * // => undefined
 */
export function inheritedRedFlag(message: string, previousUserMessage?: string): IntentDecision | undefined {
  const text = message.trim()
  const previous = previousUserMessage?.trim()

  if (!text || !previous)
    return undefined

  // A message that carries its own danger word is a fresh signal, not an
  // inherited one, and `classifyRules()` already reports it.
  if (redFlagWords.some(word => text.includes(word)))
    return undefined

  if (!redFlagWords.some(word => previous.includes(word)))
    return undefined

  if (topicEndWords.some(word => text.includes(word)))
    return undefined

  if (!continuingSymptomWords.some(word => text.includes(word)))
    return undefined

  return decision('medical', 'health-consultation', ['red_flag_inherited'])
}
