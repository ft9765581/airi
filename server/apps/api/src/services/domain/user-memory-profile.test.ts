import { describe, expect, it } from 'vitest'

import { mergeProfileWithMemories } from './user-memory-profile'

describe('mergeProfileWithMemories', () => {
  it('replaces an overlapping line and keeps the other handwritten lines', () => {
    const merged = mergeProfileWithMemories([
      '称呼：小雅',
      '产后第 7 天，剖宫产，双胎',
      '青霉素过敏',
    ].join('\n'), [{
      id: 'allergy',
      category: 'allergy',
      content: '用户对青霉素过敏',
      createdAt: 2,
    }])

    expect(merged.content).toBe([
      '称呼：小雅',
      '产后第 7 天，剖宫产，双胎',
      '用户对青霉素过敏',
    ].join('\n'))
    expect(merged.appliedIds).toEqual(['allergy'])
  })

  it('appends a new fact under its category heading', () => {
    const merged = mergeProfileWithMemories('称呼：小雅', [{
      id: 'sleep',
      category: 'visit',
      content: '用户夜里因为涨奶睡不好',
      createdAt: 1,
    }])

    expect(merged.content).toBe([
      '称呼：小雅',
      '',
      '本次咨询',
      '用户夜里因为涨奶睡不好',
    ].join('\n'))
  })

  it('keeps one line when a newer fact overlaps the same sentence', () => {
    const merged = mergeProfileWithMemories('产后第 7 天，剖宫产，双胎', [
      {
        id: 'older',
        category: 'history',
        content: '用户是剖宫产，目前是产后第 7 天',
        createdAt: 1,
      },
      {
        id: 'newer',
        category: 'history',
        content: '用户是剖宫产，目前是产后第 8 天',
        createdAt: 2,
      },
    ])

    expect(merged.content).toContain('用户是剖宫产，目前是产后第 8 天')
    expect(merged.content).not.toContain('产后第 7 天')
    expect(merged.appliedIds).toEqual(['newer', 'older'])
  })

  it('adds a second fact under a heading that already exists', () => {
    const merged = mergeProfileWithMemories([
      '本次咨询',
      '用户夜里睡不好',
    ].join('\n'), [{
      id: 'milk',
      category: 'visit',
      content: '用户涨奶',
      createdAt: 3,
    }])

    expect(merged.content).toBe([
      '本次咨询',
      '用户夜里睡不好',
      '用户涨奶',
    ].join('\n'))
  })

  it('continues an older section when the current heading is absent', () => {
    const merged = mergeProfileWithMemories([
      '基本情况',
      '用户有哮喘',
      '',
      '主要困扰',
      '用户咳嗽',
    ].join('\n'), [
      {
        id: 'surgery',
        category: 'history',
        content: '用户做过剖宫产',
        createdAt: 4,
      },
      {
        id: 'age',
        category: 'demographics',
        content: '用户 32 岁',
        createdAt: 5,
      },
    ])

    expect(merged.content).toBe([
      '基本情况',
      '用户有哮喘',
      '用户做过剖宫产',
      '',
      '主要困扰',
      '用户咳嗽',
      '',
      '人口基础信息',
      '用户 32 岁',
    ].join('\n'))
  })
})
