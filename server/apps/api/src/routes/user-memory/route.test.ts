import type { Database } from '../../libs/db'
import type { HonoEnv } from '../../types/hono'

import { Hono } from 'hono'
import { beforeAll, describe, expect, it } from 'vitest'

import { mockDB } from '../../libs/mock-db'
import { createUserMemoryService } from '../../services/domain/user-memory'
import { ApiError } from '../../utils/error'
import { createUserMemoryRoutes } from './index'

import * as schema from '../../schemas'

describe('userMemoryRoutes', () => {
  let app: Hono<HonoEnv>
  let owner: { id: string }
  let other: { id: string }

  beforeAll(async () => {
    const db: Database = await mockDB(schema)
    const service = createUserMemoryService(db)
    const [first, second] = await db.insert(schema.user).values([
      { id: 'owner', name: 'Owner', email: 'owner-memory@example.com' },
      { id: 'other', name: 'Other', email: 'other-memory@example.com' },
    ]).returning()
    owner = first!
    other = second!

    const routes = createUserMemoryRoutes(service)
    app = new Hono<HonoEnv>()
    app.onError((err, c) => {
      if (err instanceof ApiError)
        return c.json({ error: err.errorCode, message: err.message }, err.statusCode)
      return c.json({ error: 'Internal Server Error', message: err.message }, 500)
    })
    app.use('*', async (c, next) => {
      const user = (c.env as { user?: typeof owner } | undefined)?.user
      if (user)
        c.set('user', user as never)
      await next()
    })
    app.route('/', routes)
  })

  it('rejects a request without a signed-in user', async () => {
    const response = await app.request('/?characterId=default&query=花生')
    expect(response.status).toBe(401)
  })

  it('stores a fact for the signed-in user only', async () => {
    const saved = await app.fetch(new Request('http://localhost/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        characterId: 'default',
        items: [{ scope: 'user', content: '用户对花生过敏', importance: 9 }],
      }),
    }), { user: owner } as never)
    expect(saved.status).toBe(200)

    const ownerSearch = await app.fetch(
      new Request('http://localhost/?characterId=default&query=花生'),
      { user: owner } as never,
    )
    const ownerBody = await ownerSearch.json() as { memories: Array<{ content: string }> }
    expect(ownerBody.memories).toHaveLength(1)
    expect(ownerBody.memories[0]?.content).toBe('用户对花生过敏')

    const otherSearch = await app.fetch(
      new Request('http://localhost/?characterId=default&query=花生'),
      { user: other } as never,
    )
    expect(await otherSearch.json()).toEqual({ memories: [] })
  })

  it('rejects a fact that is too short', async () => {
    const response = await app.fetch(new Request('http://localhost/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        characterId: 'default',
        items: [{ scope: 'user', content: '茶', importance: 5 }],
      }),
    }), { user: owner } as never)

    expect(response.status).toBe(400)
  })

  it('lists facts for the signed-in user and deletes only that user fact', async () => {
    const listed = await app.fetch(new Request('http://localhost/items'), { user: owner } as never)
    const body = await listed.json() as { memories: Array<{ id: string, content: string }> }
    expect(body.memories.some(memory => memory.content === '用户对花生过敏')).toBe(true)

    const memoryId = body.memories.find(memory => memory.content === '用户对花生过敏')?.id
    const removed = await app.fetch(new Request(`http://localhost/${memoryId}`, { method: 'DELETE' }), { user: other } as never)
    expect(removed.status).toBe(404)

    const deleted = await app.fetch(new Request(`http://localhost/${memoryId}`, { method: 'DELETE' }), { user: owner } as never)
    expect(deleted.status).toBe(204)

    const after = await app.fetch(new Request('http://localhost/items'), { user: owner } as never)
    const afterBody = await after.json() as { memories: Array<{ content: string }> }
    expect(afterBody.memories.some(memory => memory.content === '用户对花生过敏')).toBe(false)
  })
})
