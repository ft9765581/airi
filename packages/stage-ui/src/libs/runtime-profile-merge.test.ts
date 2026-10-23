import { describe, expect, it } from 'vitest'

import { planCardSync, planExpressionSync, planFieldSync, shouldAskRuntimeImport, shouldWriteAccountField } from './runtime-profile-merge'

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

describe('planExpressionSync', () => {
  it('does not let an unstamped stale browser overwrite account choices', () => {
    // ROOT CAUSE:
    //
    // Cursor kept older f01 locally. After Chrome uploaded f02, Cursor still
    // pushed f01 because unstamped local+hasChoices always won.
    expect(planExpressionSync({
      localUpdatedAt: null,
      localHasChoices: true,
      remoteHasChoices: true,
      contentEqual: false,
      remote: {
        value: { activeGroups: { f02: true } },
        updatedAt: '2026-10-22T10:38:00.000Z',
      },
    })).toEqual({
      type: 'apply',
      value: { activeGroups: { f02: true } },
      updatedAt: '2026-10-22T10:38:00.000Z',
    })
  })

  it('uploads unstamped local choices into an empty account', () => {
    expect(planExpressionSync({
      localUpdatedAt: null,
      localHasChoices: true,
      remoteHasChoices: false,
      contentEqual: false,
      remote: {
        value: { activeGroups: {} },
        updatedAt: '2026-10-22T10:30:05.751Z',
      },
    })).toEqual({ type: 'push' })
  })

  it('pushes when the local blob time is newer', () => {
    expect(planExpressionSync({
      localUpdatedAt: '2026-10-22T10:40:00.000Z',
      localHasChoices: true,
      remoteHasChoices: true,
      contentEqual: false,
      remote: {
        value: { activeGroups: { f01: true } },
        updatedAt: '2026-10-22T10:30:05.751Z',
      },
    })).toEqual({ type: 'push' })
  })

  it('applies account choices when a newer local blob is empty', () => {
    // ROOT CAUSE:
    //
    // Cursor remounted Live2D, wrote an empty expression blob with a fresher
    // updatedAt than Chrome's f02, then refused to apply because LWW said
    // "local". Sync stayed split: account had f02, Cursor stayed empty.
    expect(planExpressionSync({
      localUpdatedAt: '2026-10-22T10:47:30.624Z',
      localHasChoices: false,
      remoteHasChoices: true,
      contentEqual: false,
      remote: {
        value: { activeGroups: { f02: true } },
        updatedAt: '2026-10-22T10:45:11.166Z',
      },
    })).toEqual({
      type: 'apply',
      value: { activeGroups: { f02: true } },
      updatedAt: '2026-10-22T10:45:11.166Z',
    })
  })

  it('applies account expressions when this browser has no local choices', () => {
    expect(planExpressionSync({
      localUpdatedAt: null,
      localHasChoices: false,
      remoteHasChoices: true,
      contentEqual: false,
      remote: {
        value: { activeGroups: { f01: true } },
        updatedAt: '2026-10-22T10:30:05.751Z',
      },
    })).toEqual({
      type: 'apply',
      value: { activeGroups: { f01: true } },
      updatedAt: '2026-10-22T10:30:05.751Z',
    })
  })

  it('keeps matching expression blobs idle', () => {
    expect(planExpressionSync({
      localUpdatedAt: '2026-10-22T10:30:05.751Z',
      localHasChoices: true,
      remoteHasChoices: true,
      contentEqual: true,
      remote: {
        value: { activeGroups: { f01: true } },
        updatedAt: '2026-10-22T10:30:05.751Z',
      },
    })).toEqual({ type: 'none' })
  })
})

describe('shouldAskRuntimeImport', () => {
  it('asks once when the account has no settings row and no stored choice', () => {
    expect(shouldAskRuntimeImport({ hasSettingsRow: false, storedChoice: null })).toBe(true)
  })

  it('does not ask again after a reload when a choice is stored', () => {
    expect(shouldAskRuntimeImport({ hasSettingsRow: false, storedChoice: 'dismissed' })).toBe(false)
    expect(shouldAskRuntimeImport({ hasSettingsRow: false, storedChoice: 'saved' })).toBe(false)
  })

  it('does not ask when the account already has a settings row', () => {
    expect(shouldAskRuntimeImport({ hasSettingsRow: true, storedChoice: null })).toBe(false)
  })
})

describe('shouldWriteAccountField', () => {
  it('copies a newer account value', () => {
    expect(shouldWriteAccountField('apply', false)).toBe(true)
  })

  it('copies an equal save when this browser does not show the value', () => {
    expect(shouldWriteAccountField('none', false)).toBe(true)
    expect(shouldWriteAccountField('none', true)).toBe(false)
  })

  it('keeps a newer local save', () => {
    expect(shouldWriteAccountField('push', false)).toBe(false)
  })
})
