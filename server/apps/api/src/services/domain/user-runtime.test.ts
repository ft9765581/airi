import type { Database } from '../../libs/db'

import { beforeAll, describe, expect, it } from 'vitest'

import { mockDB } from '../../libs/mock-db'
import { createUserRuntimeService } from './user-runtime'

import * as schema from '../../schemas'

describe('userRuntimeService', () => {
  let db: Database
  let service: ReturnType<typeof createUserRuntimeService>

  beforeAll(async () => {
    db = await mockDB(schema)
    service = createUserRuntimeService(db)
    await db.insert(schema.user).values({
      id: 'user-1',
      name: 'Test User',
      email: 'runtime@example.com',
    })
  })

  it('stores a card and returns it in the owner snapshot', async () => {
    const saved = await service.saveCard('user-1', 'default', { name: 'ReLU' }, new Date('2026-01-01T00:00:00.000Z'))

    expect(saved.applied).toBe(true)
    expect(saved.record.card).toEqual({ name: 'ReLU' })

    const snapshot = await service.getSnapshot('user-1')
    expect(snapshot.cards).toHaveLength(1)
    expect(snapshot.cards[0]?.cardId).toBe('default')
  })

  it('keeps the newer card when an older save arrives', async () => {
    await service.saveCard('user-1', 'default', { name: 'Newer' }, new Date('2026-02-01T00:00:00.000Z'))
    const older = await service.saveCard('user-1', 'default', { name: 'Older' }, new Date('2026-01-15T00:00:00.000Z'))

    expect(older.applied).toBe(false)
    expect(older.record.card).toEqual({ name: 'Newer' })
  })

  it('merges settings fields by their own timestamps', async () => {
    await service.saveSettings('user-1', {
      activeCardId: 'default',
      activeCardUpdatedAt: new Date('2026-03-01T00:00:00.000Z'),
      profileContent: 'first profile',
      profileUpdatedAt: new Date('2026-03-01T00:00:00.000Z'),
    })

    const merged = await service.saveSettings('user-1', {
      activeCardId: 'other',
      activeCardUpdatedAt: new Date('2026-03-02T00:00:00.000Z'),
      profileContent: 'stale profile',
      profileUpdatedAt: new Date('2026-02-01T00:00:00.000Z'),
    })

    expect(merged.activeCardId).toBe('other')
    expect(merged.profileContent).toBe('first profile')
  })

  it('soft-deletes a card and ignores an older delete', async () => {
    await service.saveCard('user-1', 'extra', { name: 'Extra' }, new Date('2026-04-02T00:00:00.000Z'))
    const staleDelete = await service.deleteCard('user-1', 'extra', new Date('2026-04-01T00:00:00.000Z'))
    expect(staleDelete?.applied).toBe(false)
    expect(staleDelete?.record.deletedAt).toBeNull()

    const deleted = await service.deleteCard('user-1', 'extra', new Date('2026-04-03T00:00:00.000Z'))
    expect(deleted?.applied).toBe(true)
    expect(deleted?.record.deletedAt).not.toBeNull()
  })

  it('hides the profile after account deletion', async () => {
    await service.deleteAllForUser('user-1')
    const snapshot = await service.getSnapshot('user-1')

    expect(snapshot.settings?.deletedAt).not.toBeNull()
    expect(snapshot.cards.every(card => card.deletedAt != null)).toBe(true)
  })
})
