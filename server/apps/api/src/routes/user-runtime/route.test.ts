import type { Database } from '../../libs/db'
import type { HonoEnv } from '../../types/hono'

import { Hono } from 'hono'
import { beforeAll, describe, expect, it } from 'vitest'

import { mockDB } from '../../libs/mock-db'
import { createUserRuntimeService } from '../../services/domain/user-runtime'
import { ApiError } from '../../utils/error'
import { createUserRuntimeRoutes } from './index'

import * as schema from '../../schemas'

describe('userRuntimeRoutes', () => {
  let app: Hono<HonoEnv>
  let owner: { id: string }
  let other: { id: string }

  beforeAll(async () => {
    const db: Database = await mockDB(schema)
    const service = createUserRuntimeService(db)
    const [first, second] = await db.insert(schema.user).values([
      { id: 'owner', name: 'Owner', email: 'owner@example.com' },
      { id: 'other', name: 'Other', email: 'other@example.com' },
    ]).returning()
    owner = first!
    other = second!

    const routes = createUserRuntimeRoutes(service)
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
    const response = await app.request('/')
    expect(response.status).toBe(401)
  })

  it('returns an empty snapshot for a new account', async () => {
    const response = await app.fetch(new Request('http://localhost/'), { user: owner } as never)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ settings: null, cards: [] })
  })

  it('saves settings and a card for the signed-in user only', async () => {
    const settings = await app.fetch(new Request('http://localhost/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        activeCardId: 'default',
        activeCardUpdatedAt: '2026-05-01T00:00:00.000Z',
        profileContent: 'Name: Yuki',
        profileUpdatedAt: '2026-05-01T00:00:00.000Z',
      }),
    }), { user: owner } as never)
    expect(settings.status).toBe(200)

    const card = await app.fetch(new Request('http://localhost/cards/default', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        updatedAt: '2026-05-01T00:00:00.000Z',
        card: { name: 'ReLU' },
      }),
    }), { user: owner } as never)
    expect(card.status).toBe(200)

    const otherSnapshot = await app.fetch(new Request('http://localhost/'), { user: other } as never)
    expect(await otherSnapshot.json()).toEqual({ settings: null, cards: [] })
  })

  it('keeps the newer card when an older save arrives', async () => {
    await app.fetch(new Request('http://localhost/cards/default', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        updatedAt: '2026-06-01T00:00:00.000Z',
        card: { name: 'Newer' },
      }),
    }), { user: owner } as never)

    const older = await app.fetch(new Request('http://localhost/cards/default', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        updatedAt: '2026-05-02T00:00:00.000Z',
        card: { name: 'Older' },
      }),
    }), { user: owner } as never)

    const body = await older.json() as { applied: boolean, record: { card: { name: string } } }
    expect(body.applied).toBe(false)
    expect(body.record.card.name).toBe('Newer')
  })
})
