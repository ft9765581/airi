import { describe, expect, it } from 'vitest'

import { formatCoarseRelativeTime } from './coarse-relative-time'

describe('formatCoarseRelativeTime', () => {
  const now = Date.parse('2026-10-22T08:00:00.000Z')

  it('labels a minute and the day before yesterday in Chinese', () => {
    expect(formatCoarseRelativeTime(now - 60_000, now, 'zh-Hans')).toBe('1分钟前')
    expect(formatCoarseRelativeTime(now - 2 * 86_400_000, now, 'zh-Hans')).toBe('前天')
  })

  it('labels five minutes in English', () => {
    expect(formatCoarseRelativeTime(now - 5 * 60_000, now, 'en')).toBe('5 minutes ago')
  })
})
