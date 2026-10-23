import { describe, expect, it } from 'vitest'

import { startOfZonedDay } from './zoned-day'

describe('startOfZonedDay', () => {
  it('returns local midnight in Shanghai as a UTC instant', () => {
    const start = startOfZonedDay('Asia/Shanghai', new Date('2026-10-22T08:00:00.000Z'))

    expect(start.toISOString()).toBe('2026-10-21T16:00:00.000Z')
  })

  it('uses UTC when the zone name is not real', () => {
    const start = startOfZonedDay('Not/AZone', new Date('2026-10-22T08:30:00.000Z'))

    expect(start.toISOString()).toBe('2026-10-22T00:00:00.000Z')
  })
})
