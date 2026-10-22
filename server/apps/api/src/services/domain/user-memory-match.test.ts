import { describe, expect, it } from 'vitest'

import { scoreMemoryMatch } from './user-memory'

describe('scoreMemoryMatch', () => {
  it('links an age question to a stored age fact', () => {
    expect(scoreMemoryMatch('我多大你不知道吗', '用户今年30岁。')).toBeGreaterThanOrEqual(1 / 3)
  })

  it('still rejects an unrelated weather question', () => {
    expect(scoreMemoryMatch('今天天气不错', '用户今年30岁。')).toBeLessThan(1 / 3)
  })

  it('keeps digit tokens so a year fact can match', () => {
    expect(scoreMemoryMatch('我是不是30岁', '用户今年30岁。')).toBeGreaterThanOrEqual(1 / 3)
  })
})
