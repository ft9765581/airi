import { describe, expect, it } from 'vitest'

import { planCardSync, planFieldSync } from './runtime-profile-merge'

describe('planCardSync', () => {
  it('does not upload a local card that has no save time', () => {
    expect(planCardSync({
      localExists: true,
      localUpdatedAt: null,
      remote: null,
    })).toEqual({ type: 'none' })
  })

  it('uploads a local card the account does not have', () => {
    expect(planCardSync({
      localExists: true,
      localUpdatedAt: '2026-01-02T00:00:00.000Z',
      remote: null,
    })).toEqual({ type: 'push' })
  })

  it('applies a newer account card', () => {
    expect(planCardSync({
      localExists: true,
      localUpdatedAt: '2026-01-01T00:00:00.000Z',
      remote: {
        cardId: 'default',
        card: { name: 'Remote' },
        updatedAt: '2026-01-02T00:00:00.000Z',
        deletedAt: null,
      },
    })).toEqual({
      type: 'apply',
      card: { name: 'Remote' },
      updatedAt: '2026-01-02T00:00:00.000Z',
    })
  })

  it('keeps a local card that was saved later', () => {
    expect(planCardSync({
      localExists: true,
      localUpdatedAt: '2026-01-03T00:00:00.000Z',
      remote: {
        cardId: 'default',
        card: { name: 'Remote' },
        updatedAt: '2026-01-02T00:00:00.000Z',
        deletedAt: null,
      },
    })).toEqual({ type: 'push' })
  })

  it('does nothing when the timestamps already match', () => {
    expect(planCardSync({
      localExists: true,
      localUpdatedAt: '2026-01-02T00:00:00.000Z',
      remote: {
        cardId: 'default',
        card: { name: 'Same' },
        updatedAt: '2026-01-02T00:00:00.000Z',
        deletedAt: null,
      },
    })).toEqual({ type: 'none' })
  })

  it('removes a local card when the account delete is newer', () => {
    expect(planCardSync({
      localExists: true,
      localUpdatedAt: '2026-01-02T00:00:00.000Z',
      remote: {
        cardId: 'extra',
        card: { name: 'Extra' },
        updatedAt: '2026-01-03T00:00:00.000Z',
        deletedAt: '2026-01-03T00:00:00.000Z',
      },
    })).toEqual({ type: 'remove', updatedAt: '2026-01-03T00:00:00.000Z' })
  })
})

describe('planFieldSync', () => {
  it('applies a newer remote profile without pushing', () => {
    expect(planFieldSync({
      localUpdatedAt: '2026-01-01T00:00:00.000Z',
      remote: { value: 'remote profile', updatedAt: '2026-01-02T00:00:00.000Z' },
    })).toEqual({
      type: 'apply',
      value: 'remote profile',
      updatedAt: '2026-01-02T00:00:00.000Z',
    })
  })

  it('pushes a local profile that was saved later', () => {
    expect(planFieldSync({
      localUpdatedAt: '2026-01-03T00:00:00.000Z',
      remote: { value: 'remote profile', updatedAt: '2026-01-02T00:00:00.000Z' },
    })).toEqual({ type: 'push' })
  })
})
