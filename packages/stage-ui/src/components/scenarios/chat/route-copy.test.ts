import type { TurnRoute } from '../../../types/chat'

import { describe, expect, it } from 'vitest'

import { medicalGateUrgentReply } from '../../../libs/intent/medical-gate'
import { routeBadgeOf, routeDetailBranchOf, routeDetailReasonOf, routeNoticeOf } from './route-copy'

const route = (kind: TurnRoute['kind'], reason?: string): TurnRoute => ({ kind, reason })

describe('routeBadgeOf', () => {
  it('puts no tag on a medical answer: the notice under it carries the meaning', () => {
    expect(routeBadgeOf(route('medical'))).toBeUndefined()
  })

  it('labels a fallback answer', () => {
    expect(routeBadgeOf(route('fallback'))?.text).toBe('兜底回复')
  })

  it('leaves an emergency answer to its action header', () => {
    // The card leads with "立即就医"; a second tag would say the same thing.
    expect(routeBadgeOf(route('urgent'))).toBeUndefined()
  })

  it('marks nothing on an ordinary chat answer', () => {
    expect(routeBadgeOf(route('chat'))).toBeUndefined()
    expect(routeBadgeOf(undefined)).toBeUndefined()
  })
})

describe('routeNoticeOf', () => {
  it('tells the reader a medical answer is guidance, not a diagnosis', () => {
    expect(routeNoticeOf(route('medical'))?.text).toContain('不能替代医生诊断')
  })

  it('does not repeat the emergency action it already shows above', () => {
    // The card header says "请前往急诊或拨打 120". Repeating it here reads as
    // two different instructions, so the notice only carries the disclaimer.
    const notice = routeNoticeOf(route('urgent'))?.text ?? ''

    expect(notice).toContain('不能替代医生面诊')
    expect(notice).not.toContain('120')

    // The fixed reply still names the action, which is where the reader first
    // meets it when generation is off.
    expect(medicalGateUrgentReply).toContain('120')
  })

  it('says a fallback answer is fixed copy', () => {
    expect(routeNoticeOf(route('fallback'))?.text).toContain('固定回复')
  })

  it('says nothing about an ordinary chat answer', () => {
    expect(routeNoticeOf(route('chat'))).toBeUndefined()
  })
})

describe('routeDetailBranchOf', () => {
  it.each([
    ['urgent', '本轮使用急诊指引'],
    ['medical', '本轮使用医疗咨询'],
    ['fallback', '本轮使用兜底回复'],
  ] as const)('states the %s branch as a fact', (kind, expected) => {
    expect(routeDetailBranchOf(route(kind))).toBe(expected)
  })

  it('offers no detail entry for ordinary chat', () => {
    expect(routeDetailBranchOf(route('chat'))).toBeUndefined()
    expect(routeDetailBranchOf(undefined)).toBeUndefined()
  })
})

describe('routeDetailReasonOf', () => {
  it.each([
    ['red_flag', '当前消息命中了急症词'],
    ['red_flag_inherited', '承接了上一轮的急症描述'],
    ['deployment_disabled', '部署没有开启医疗生成'],
    ['agent_missing', '角色卡没有填写医疗配置'],
    ['agent_disabled', '角色卡的医疗助手开关是关闭的'],
    ['prompt_empty', '角色卡的医疗提示词是空的'],
    ['classifier_failed', '分类失败，按安全兜底处理'],
  ])('turns %s into a sentence', (reason, expected) => {
    expect(routeDetailReasonOf(route('medical', reason))).toBe(expected)
  })

  it('groups every classifier failure code under one sentence', () => {
    expect(routeDetailReasonOf(route('fallback', 'fallback:timeout'))).toBe('分类请求失败，按安全兜底处理')
    expect(routeDetailReasonOf(route('fallback', 'fallback:parse'))).toBe('分类请求失败，按安全兜底处理')
  })

  it('shows no line for a code it does not own', () => {
    // Leaking a raw code into the interface tells the reader nothing.
    expect(routeDetailReasonOf(route('medical', 'something_new'))).toBeUndefined()
    expect(routeDetailReasonOf(route('medical'))).toBeUndefined()
  })
})
