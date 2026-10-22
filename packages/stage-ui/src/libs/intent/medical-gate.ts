import { classifyRules } from './classify-rules'

/**
 * The phase-one medical gate: a fixed reply instead of a model answer.
 *
 * A medical question never reaches the model, because this deployment has no
 * way to check a medical answer the model writes. The decision now comes from
 * `classifyRules`, so this file only maps a decision to the line the user sees.
 *
 * This stays a separate module from the classifier on purpose: the classifier
 * answers "is this medical", while the reply is product copy that changes for
 * its own reasons.
 */

/** The reply for a medical question the app cannot answer yet. */
export const medicalGateReply
  = '这个问题我暂时回答不了。你可以说说具体哪里不舒服、多久了'

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
  const result = classifyRules(message)
  if (result.decision !== 'medical')
    return null

  // A danger signal must not hear "I cannot answer", so it gets the line that
  // names the action instead.
  if (result.evidenceCodes.includes('red_flag'))
    return medicalGateUrgentReply

  return medicalGateReply
}
