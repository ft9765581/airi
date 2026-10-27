import type { TurnRoute } from '../../../types/chat'

/**
 * The words a routed chat bubble shows for its branch.
 *
 * The copy lives here, apart from the component, because it is product policy:
 * which branch is labelled, what the reader must not conclude, and how a router
 * reason becomes a sentence a person can read. A component that hard-codes these
 * strings cannot be checked without mounting a chat page.
 *
 * Everything is Chinese only. The product copy has one maintained language for
 * now (§6.1 of the medical consultation design).
 */

/** One small label above an answer. */
export interface RouteBadge {
  text: string
  class: string
}

/**
 * The label a branch must show, if any.
 *
 * A generated medical answer names its branch, because the reader has to know a
 * consultation answered. An emergency answer leads with its own action header
 * instead, and ordinary chat carries nothing at all.
 */
export function routeBadgeOf(route: TurnRoute | undefined): RouteBadge | undefined {
  switch (route?.kind) {
    case 'medical':
      return {
        text: '医疗咨询',
        class: 'border-teal-300 bg-teal-50 text-teal-700 dark:border-teal-900 dark:bg-teal-950/40 dark:text-teal-300',
      }
    case 'fallback':
      return {
        text: '兜底回复',
        class: 'border-neutral-300 bg-neutral-100 text-neutral-600 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300',
      }
    default:
      return undefined
  }
}

/**
 * The line under a routed answer: what the reader must not conclude from it.
 *
 * It sits under the text because a reader who finished the answer is the one who
 * needs it. The emergency line does not repeat "拨打 120": the action header
 * above already says it, and saying it twice reads as two different instructions.
 */
export function routeNoticeOf(route: TurnRoute | undefined): RouteBadge | undefined {
  switch (route?.kind) {
    case 'medical':
      return {
        text: '以上是普通健康指引，不能替代医生诊断。症状加重或出现紧急情况，请立即就医。',
        class: 'text-neutral-500 dark:text-neutral-400',
      }
    case 'urgent':
      return {
        text: '以上不是诊断结论，不能替代医生面诊。',
        class: 'text-red-700 dark:text-red-300',
      }
    case 'fallback':
      return {
        text: '这一轮没有生成医疗回答，以上是固定回复。',
        class: 'text-neutral-500 dark:text-neutral-400',
      }
    default:
      return undefined
  }
}

/**
 * The fact the detail entry states: which branch answered this turn.
 *
 * It names the branch and nothing else. The system prompt, the classifier
 * verdict and the evidence codes stay out of the reader's view: the entry
 * answers "who answered me", not "how does the router work".
 */
export function routeDetailBranchOf(route: TurnRoute | undefined): string | undefined {
  switch (route?.kind) {
    case 'urgent':
      return '本轮使用急诊指引'
    case 'medical':
      return '本轮使用医疗咨询'
    case 'fallback':
      return '本轮使用兜底回复'
    default:
      return undefined
  }
}

/**
 * Why the router chose this branch, in the reader's words.
 *
 * A reason is a code for logs (`red_flag`, `agent_disabled`). A reader needs the
 * fact behind it, so an unknown code shows no line at all instead of leaking the
 * code into the interface.
 */
export function routeDetailReasonOf(route: TurnRoute | undefined): string | undefined {
  const reason = route?.reason

  if (!reason)
    return undefined
  if (reason.startsWith('fallback:'))
    return '分类请求失败，按安全兜底处理'

  switch (reason) {
    case 'red_flag':
      return '当前消息命中了急症词'
    case 'red_flag_inherited':
      return '承接了上一轮的急症描述'
    case 'deployment_disabled':
      return '部署没有开启医疗生成'
    case 'agent_missing':
      return '角色卡没有填写医疗配置'
    case 'agent_disabled':
      return '角色卡的医疗助手开关是关闭的'
    case 'prompt_empty':
      return '角色卡的医疗提示词是空的'
    case 'classifier_failed':
      return '分类失败，按安全兜底处理'
    default:
      return undefined
  }
}
