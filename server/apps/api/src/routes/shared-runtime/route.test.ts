import type { HonoEnv } from '../../types/hono'

import { Hono } from 'hono'
import { beforeAll, describe, expect, it } from 'vitest'

import { mockDB } from '../../libs/mock-db'
import { configKV } from '../../schemas/config-kv'
import { ApiError } from '../../utils/error'
import { createSharedRuntimeRoutes } from './index'

describe('shared runtime settings', () => {
  let app: Hono<HonoEnv>

  beforeAll(async () => {
    const db = await mockDB({ configKV })
    app = new Hono<HonoEnv>()
    app.onError((error, context) => error instanceof ApiError
      ? context.json({ error: error.errorCode }, error.statusCode)
      : context.json({ error: 'INTERNAL_SERVER_ERROR' }, 500))
    app.use('*', async (context, next) => {
      context.set('user', (context.env as { user?: HonoEnv['Variables']['user'] })?.user ?? null)
      await next()
    })
    app.route('/', createSharedRuntimeRoutes(db, 'nurse@example.com'))
  })

  const settings = {
    cards: [{ id: 'nurse', card: { name: 'Nurse' } }],
    activeCardId: 'nurse',
    models: {
      chatProvider: 'official',
      chatModel: 'auto',
      speechProvider: 'official',
      speechModel: 'auto',
      speechVoice: '',
      hearingProvider: '',
      hearingModel: '',
      visionProvider: '',
      visionModel: '',
      artistryProvider: '',
      artistryModel: '',
    },
    knowledgeBase: [{ id: 'medical', name: 'Medical', baseUrl: '/api/v1/knowledge-base/retrieval', knowledgeBaseId: 'kb', enabled: true }],
  }
  const admin = { email: 'nurse@example.com', emailVerified: true }
  const member = { email: 'member@example.com', emailVerified: true }

  it('allows only the verified administrator to publish', async () => {
    for (const user of [member, { ...admin, emailVerified: false }]) {
      const response = await app.fetch(new Request('http://localhost/', { method: 'PUT', body: JSON.stringify(settings) }), { user } as never)
      expect(response.status).toBe(403)
    }
    const response = await app.fetch(new Request('http://localhost/', { method: 'PUT', body: JSON.stringify(settings) }), { user: admin } as never)
    expect(response.status).toBe(200)
  })

  it('lets an unverified phone account publish when it is the configured administrator', async () => {
    const phoneAdmin = '13900002222@phone.local'
    const phoneApp = new Hono<HonoEnv>()
    phoneApp.onError((error, context) => error instanceof ApiError
      ? context.json({ error: error.errorCode }, error.statusCode)
      : context.json({ error: 'INTERNAL_SERVER_ERROR' }, 500))
    phoneApp.use('*', async (context, next) => {
      context.set('user', (context.env as { user?: HonoEnv['Variables']['user'] })?.user ?? null)
      await next()
    })
    phoneApp.route('/', createSharedRuntimeRoutes(await mockDB({ configKV }), phoneAdmin))

    // This deployment has no mail service, so a phone account can never set the
    // flag. Refusing it would leave nobody able to publish.
    const unverified = { email: phoneAdmin, emailVerified: false }
    const allowed = await phoneApp.fetch(new Request('http://localhost/', { method: 'PUT', body: JSON.stringify(settings) }), { user: unverified } as never)
    expect(allowed.status).toBe(200)

    // An ordinary mailbox with the administrator address still needs the flag.
    const mailboxApp = new Hono<HonoEnv>()
    mailboxApp.onError((error, context) => error instanceof ApiError
      ? context.json({ error: error.errorCode }, error.statusCode)
      : context.json({ error: 'INTERNAL_SERVER_ERROR' }, 500))
    mailboxApp.use('*', async (context, next) => {
      context.set('user', (context.env as { user?: HonoEnv['Variables']['user'] })?.user ?? null)
      await next()
    })
    mailboxApp.route('/', createSharedRuntimeRoutes(await mockDB({ configKV }), 'owner@example.com'))

    const refused = await mailboxApp.fetch(new Request('http://localhost/', { method: 'PUT', body: JSON.stringify(settings) }), {
      user: { email: 'owner@example.com', emailVerified: false },
    } as never)
    expect(refused.status).toBe(403)
  })

  it('serves the same published settings to another user', async () => {
    const response = await app.fetch(new Request('http://localhost/'), { user: member } as never)
    expect(response.status).toBe(200)
    const result = await response.json() as { settings: typeof settings, canEdit: boolean }
    expect(result.settings).toEqual(settings)
    expect(result.canEdit).toBe(false)
  })

  it('drops unexpected fields from the public snapshot', async () => {
    const response = await app.fetch(new Request('http://localhost/', { method: 'PUT', body: JSON.stringify({
      ...settings,
      knowledgeBase: [{ ...settings.knowledgeBase[0], apiKey: 'secret' }],
    }) }), { user: admin } as never)
    expect(response.status).toBe(200)
    const read = await app.fetch(new Request('http://localhost/'), { user: member } as never)
    expect(JSON.stringify(await read.json())).not.toContain('secret')
  })
})
