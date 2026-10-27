import type { RemoteIntentCollection } from './api'

import { describe, expect, it } from 'vitest'

import { collectionBlockedReason, collectionsFor } from './collection-policy'

function collection(id: string, purpose: 'development' | 'acceptance'): RemoteIntentCollection {
  return {
    id,
    name: id,
    purpose,
    createdAt: '2026-10-27T00:00:00.000Z',
    updatedAt: '2026-10-27T00:00:00.000Z',
  }
}

describe('collectionsFor', () => {
  it('offers only development collections to the bench', () => {
    const result = collectionsFor('bench', [collection('dev', 'development'), collection('acc', 'acceptance')])

    expect(result.map(item => item.id)).toEqual(['dev'])
  })

  it('offers only acceptance collections to the acceptance surface', () => {
    const result = collectionsFor('acceptance', [collection('dev', 'development'), collection('acc', 'acceptance')])

    expect(result.map(item => item.id)).toEqual(['acc'])
  })
})

describe('collectionBlockedReason', () => {
  it('blocks an acceptance selection on the bench', () => {
    // A stored selection outlives the page: tuning against it would turn the
    // acceptance set into another development set.
    expect(collectionBlockedReason('bench', collection('acc', 'acceptance')))
      .toBe('验收集只在最终验收时使用，测试台不能选它')
  })

  it('allows a development selection on the bench', () => {
    expect(collectionBlockedReason('bench', collection('dev', 'development'))).toBeUndefined()
  })

  it('blocks a development selection in the acceptance surface', () => {
    expect(collectionBlockedReason('acceptance', collection('dev', 'development'))).toBeDefined()
  })

  it('says nothing when no collection is selected', () => {
    expect(collectionBlockedReason('bench', undefined)).toBeUndefined()
  })
})
