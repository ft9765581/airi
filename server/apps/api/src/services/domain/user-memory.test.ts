import type { Database } from '../../libs/db'

import { eq } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'

import { mockDB } from '../../libs/mock-db'
import { createUserMemoryService } from './user-memory'

import * as schema from '../../schemas'

describe('userMemoryService', () => {
  let db: Database
  let service: ReturnType<typeof createUserMemoryService>

  beforeAll(async () => {
    db = await mockDB(schema)
    service = createUserMemoryService(db)
  })

  it('returns a user fact on every character card when the message overlaps', async () => {
    await service.remember('user-1', 'card-a', [{
      scope: 'user',
      content: '用户对花生过敏',
      importance: 9,
    }])

    const onOtherCard = await service.search('user-1', 'card-b', '我花生过敏了')

    expect(onOtherCard).toHaveLength(1)
    expect(onOtherCard[0]?.content).toBe('用户对花生过敏')
    expect(onOtherCard[0]?.scope).toBe('user')
  })

  it('keeps a character fact on the card that stored it', async () => {
    await service.remember('user-1', 'card-a', [{
      scope: 'character',
      content: '这张角色卡答应下周提醒复查',
      importance: 6,
    }])

    const sameCard = await service.search('user-1', 'card-a', '下周复查提醒')
    const otherCard = await service.search('user-1', 'card-b', '下周复查提醒')

    expect(sameCard.some(memory => memory.content === '这张角色卡答应下周提醒复查')).toBe(true)
    expect(otherCard.some(memory => memory.content === '这张角色卡答应下周提醒复查')).toBe(false)
  })

  it('leaves out a fact that does not share the message', async () => {
    const matches = await service.search('user-1', 'card-a', '今天天气不错')

    expect(matches.every(memory => memory.content !== '用户对花生过敏')).toBe(true)
  })

  it('returns an age fact when the user asks how old they are', async () => {
    await service.remember('user-age-ask', 'card-a', [{
      scope: 'user',
      content: '用户今年30岁。',
      importance: 8,
    }])

    const matches = await service.search('user-age-ask', 'card-a', '我多大你不知道吗')

    expect(matches.some(memory => memory.content === '用户今年30岁。')).toBe(true)
  })

  it('stores the same fact once', async () => {
    const first = await service.remember('user-2', 'card-a', [{
      scope: 'user',
      content: '用户喜欢喝茶',
      importance: 5,
    }])
    const second = await service.remember('user-2', 'card-a', [{
      scope: 'user',
      content: '用户喜欢喝茶',
      importance: 8,
    }])

    expect(first[0]?.created).toBe(true)
    expect(second[0]?.created).toBe(false)
    expect(second[0]?.id).toBe(first[0]?.id)

    const matches = await service.search('user-2', 'card-a', '喝茶')
    expect(matches).toHaveLength(1)
  })

  it('hides facts after account deletion', async () => {
    await service.remember('user-3', 'card-a', [{
      scope: 'user',
      content: '用户住在苏州',
      importance: 7,
    }])

    await service.deleteAllForUser('user-3')
    const matches = await service.search('user-3', 'card-a', '苏州')

    expect(matches).toHaveLength(0)
  })

  it('does not return another account fact', async () => {
    const matches = await service.search('user-9', 'card-a', '花生')

    expect(matches).toHaveLength(0)
  })

  it('ranks a recently recalled fact above an unused fact of the same age', async () => {
    const createdAt = new Date('2026-06-01T00:00:00.000Z')
    const [recalled] = await service.remember('user-decay', 'card-a', [{
      scope: 'user',
      content: '用户对花生过敏',
      importance: 5,
    }], createdAt)
    await service.remember('user-decay', 'card-a', [{
      scope: 'user',
      content: '用户提到花生酱',
      importance: 5,
    }], createdAt)
    await db.update(schema.userMemories).set({
      recallCount: 3,
      lastRecalledAt: new Date('2026-06-01T08:00:00.000Z'),
    }).where(eq(schema.userMemories.id, recalled!.id))

    const matches = await service.search('user-decay', 'card-a', '花生', new Date('2026-06-01T12:00:00.000Z'))

    expect(matches[0]?.content).toBe('用户对花生过敏')
  })

  it('leaves out a fact stored on an earlier local day', async () => {
    await service.remember('user-fresh', 'card-a', [{
      scope: 'user',
      content: '用户对花生过敏',
      importance: 5,
    }], new Date('2026-04-01T00:00:00.000Z'))
    await service.remember('user-fresh', 'card-a', [{
      scope: 'user',
      content: '用户提到花生酱',
      importance: 5,
    }], new Date('2026-06-01T00:00:00.000Z'))

    const matches = await service.search('user-fresh', 'card-a', '花生', new Date('2026-06-01T12:00:00.000Z'), 'UTC')

    expect(matches.map(memory => memory.content)).toEqual(['用户提到花生酱'])
  })

  it('replaces an older fact when a later fact shares most of its words', async () => {
    await service.remember('user-conflict', 'card-a', [{
      scope: 'user',
      content: '用户喜欢喝茶',
      importance: 5,
    }])
    const later = await service.remember('user-conflict', 'card-a', [{
      scope: 'user',
      content: '用户不喜欢喝茶',
      importance: 6,
    }])

    expect(later[0]?.created).toBe(true)
    const listed = await service.list('user-conflict')
    expect(listed.map(memory => memory.content)).toEqual(['用户不喜欢喝茶'])
  })

  it('keeps a character fact when a user fact uses similar words', async () => {
    await service.remember('user-scope', 'card-a', [{
      scope: 'user',
      content: '用户喜欢喝茶',
      importance: 5,
    }])
    await service.remember('user-scope', 'card-a', [{
      scope: 'character',
      content: '用户不喜欢喝茶',
      importance: 6,
    }])

    const listed = await service.list('user-scope')
    expect(listed).toHaveLength(2)
  })

  it('lets the later copy of the same fact set the importance', async () => {
    await service.remember('user-importance', 'card-a', [{
      scope: 'user',
      content: '用户住在杭州',
      importance: 4,
    }])
    await service.remember('user-importance', 'card-b', [{
      scope: 'user',
      content: '用户住在杭州',
      importance: 9,
    }])

    const listed = await service.list('user-importance')
    expect(listed).toHaveLength(1)
    expect(listed[0]?.importance).toBe(9)
  })

  it('hides a deleted fact from the list and from search', async () => {
    const [saved] = await service.remember('user-remove', 'card-a', [{
      scope: 'user',
      content: '用户住在苏州',
      importance: 5,
    }])
    const removed = await service.remove('user-remove', saved!.id)
    const missing = await service.remove('user-other', saved!.id)

    expect(removed).toBe(true)
    expect(missing).toBe(false)
    expect(await service.list('user-remove')).toHaveLength(0)
    expect(await service.search('user-remove', 'card-a', '苏州')).toHaveLength(0)
  })

  it('counts each search that returns a fact', async () => {
    const [saved] = await service.remember('user-recall', 'card-a', [{
      scope: 'user',
      content: '用户会说法语',
      importance: 5,
    }])

    await service.search('user-recall', 'card-a', '法语')
    await service.search('user-recall', 'card-a', '法语')
    const listed = await service.list('user-recall')

    expect(listed[0]?.id).toBe(saved!.id)
    expect(listed[0]?.recallCount).toBe(2)
  })

  it('changes the text of one fact and keeps its created time', async () => {
    const [saved] = await service.remember('user-edit', 'card-a', [{
      scope: 'user',
      content: '用户对花粉过敏',
      importance: 8,
      category: 'allergy',
    }])

    const updated = await service.update('user-edit', saved!.id, {
      content: '用户对尘螨过敏',
      category: 'allergy',
    })

    expect(updated?.content).toBe('用户对尘螨过敏')
    expect(updated?.category).toBe('allergy')
    expect(updated?.createdAt.getTime()).toBeGreaterThan(0)
    expect(await service.update('user-edit', 'missing', { content: '这条不存在' })).toBeNull()
  })

  it('folds an earlier user fact into the profile and leaves today alone', async () => {
    const now = new Date('2026-10-22T02:00:00.000Z')
    await service.remember('user-roll', 'card-a', [{
      scope: 'user',
      content: '用户对青霉素过敏',
      importance: 9,
      category: 'allergy',
    }], new Date('2026-10-21T02:00:00.000Z'))
    await service.remember('user-roll', 'card-a', [{
      scope: 'user',
      content: '用户今天喝了汤',
      importance: 4,
      category: 'other',
    }], now)
    await service.remember('user-roll', 'card-a', [{
      scope: 'character',
      content: '这张角色卡记得昨天的约定',
      importance: 4,
    }], new Date('2026-10-21T03:00:00.000Z'))

    const first = await service.rollup('user-roll', {
      timeZone: 'Asia/Shanghai',
      profileContent: '称呼：小雅\n青霉素过敏',
      profileUpdatedAt: new Date('2026-10-20T00:00:00.000Z'),
      replayIds: [],
    }, now)

    expect(first.rolledCount).toBe(1)
    expect(first.profileContent).toContain('用户对青霉素过敏')
    expect(first.profileContent).not.toContain('用户今天喝了汤')
    expect(first.profileContent).not.toContain('昨天的约定')

    const second = await service.rollup('user-roll', {
      timeZone: 'Asia/Shanghai',
      profileContent: first.profileContent,
      profileUpdatedAt: new Date(first.profileUpdatedAt),
      replayIds: [],
    }, now)

    expect(second.rolledCount).toBe(0)
  })
})
