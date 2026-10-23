import { describe, expect, it } from 'vitest'

import { formatMemoryContext } from './memory-context'

describe('formatMemoryContext', () => {
  it('returns an empty string when there are no facts', () => {
    expect(formatMemoryContext([])).toBe('')
  })

  it('labels a user fact and a character fact', () => {
    const text = formatMemoryContext([
      { scope: 'user', content: '用户对花生过敏' },
      { scope: 'character', content: '这张角色卡答应下周提醒复查' },
    ])

    expect(text).toContain('1. [user] 用户对花生过敏')
    expect(text).toContain('2. [character] 这张角色卡答应下周提醒复查')
  })

  it('keeps five facts and drops a fact that crosses the character limit', () => {
    const memories = Array.from({ length: 6 }, (_, index) => ({
      scope: 'user' as const,
      content: `事实${index}`,
    }))
    memories.push({ scope: 'user', content: '超'.repeat(1600) })

    const text = formatMemoryContext(memories)
    const factLines = text.split('\n').filter(line => /^\d+\. /.test(line))

    expect(factLines).toHaveLength(5)
    expect(text).not.toContain('事实5')
    expect(text).not.toContain('超超')
  })
})
