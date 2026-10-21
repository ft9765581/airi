/**
 * Decides whether one chat message asks a medical question, and which fixed
 * reply it gets.
 *
 * This deployment must not let the model answer a medical question on its own,
 * because nothing in the app can check that answer. The gate keeps such a send
 * out of the model and answers with a fixed line instead.
 *
 * Rule order matters. Pure acknowledgements, high-risk symptoms and general
 * medical terms are checked in that order, so one message cannot match two
 * replies. Person words such as `宝宝` or `产妇` are deliberately absent from
 * the term list: alone they carry no medical meaning, and treating them as a
 * match turns almost every message into a medical one.
 */

/** Whole-message replies that carry no question and must not reach the gate. */
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

/**
 * Symptoms that need care today.
 *
 * A fixed "I cannot answer" line is wrong for these. They get their own reply
 * that names the action, because the gate exists to keep the model quiet, not
 * to keep the patient waiting.
 */
const urgentWords = [
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

/** The reply for a medical question the app cannot answer yet. */
export const medicalGateReply
  = '这个问题我暂时回答不了。你可以说说具体哪里不舒服、多久了，我帮你判断要不要尽快去医院。'

/** The reply for a symptom that needs care today. */
export const medicalGateUrgentReply
  = '这个情况别在这里等答复，请尽快去医院急诊，或者直接拨打 120。'

/**
 * Returns the fixed reply for one message, or `null` when the message is not a
 * medical question and must go to the model as usual.
 *
 * @example
 * getMedicalGateReply('宝宝黄疸怎么看')
 * // => '这个问题我暂时回答不了。…'
 * @example
 * getMedicalGateReply('宝宝今天特别乖')
 * // => null
 */
export function getMedicalGateReply(message: string): string | null {
  const text = message.trim()
  if (!text || acknowledgementWords.has(text.toLowerCase()))
    return null

  if (urgentWords.some(word => text.includes(word)))
    return medicalGateUrgentReply

  if (vitalValuePattern.test(text))
    return medicalGateReply

  if (medicalWords.some(word => text.includes(word)))
    return medicalGateReply

  return null
}
