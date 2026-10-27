import type { Database } from '../../libs/db'
import type { HonoEnv } from '../../types/hono'

import { Hono } from 'hono'
import { beforeAll, describe, expect, it } from 'vitest'

import { createIntentEvalRoutes } from '.'
import { mockDB } from '../../libs/mock-db'
import { createIntentEvalService } from '../../services/domain/intent-eval'
import { ApiError } from '../../utils/error'

import * as schema from '../../schemas'

describe('intentEvalRoutes', () => {
  let db: Database
  let service: ReturnType<typeof createIntentEvalService>
  let app: Hono<HonoEnv>
  let testUser: { id: string }
  let otherUser: { id: string }

  function request(path: string, init?: RequestInit, user: { id: string } | null = testUser) {
    return app.fetch(new Request(`http://localhost${path}`, init), user ? { user } as any : {} as any)
  }

  function jsonBody(body: unknown, method = 'POST'): RequestInit {
    return {
      method,
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    }
  }

  beforeAll(async () => {
    db = await mockDB(schema)
    service = createIntentEvalService(db)

    const [owner] = await db.insert(schema.user).values({
      id: 'user-1',
      name: 'Owner',
      email: 'owner@example.com',
    }).returning()
    const [stranger] = await db.insert(schema.user).values({
      id: 'user-2',
      name: 'Stranger',
      email: 'stranger@example.com',
    }).returning()

    testUser = owner
    otherUser = stranger

    const routes = createIntentEvalRoutes(service)
    app = new Hono<HonoEnv>()

    app.onError((err, c) => {
      if (err instanceof ApiError) {
        return c.json({
          error: err.errorCode,
          message: err.message,
          details: err.details,
        }, err.statusCode)
      }
      return c.json({ error: 'Internal Server Error', message: err.message }, 500)
    })

    // The real middleware validates a JWT; these tests only need the user it sets.
    app.use('*', async (c, next) => {
      const user = (c.env as any)?.user
      if (user)
        c.set('user', user)
      await next()
    })

    app.route('/', routes)
  })

  it('rejects a request without a session', async () => {
    const res = await request('/samples', undefined, null)
    expect(res.status).toBe(401)
  })

  it('creates a sample and returns it', async () => {
    const res = await request('/samples', jsonBody({
      input: '宝宝黄疸怎么看',
      group: 'medical-explicit',
      expected: 'medical',
      source: 'unit test',
    }))

    expect(res.status).toBe(201)
    const sample = await res.json() as any
    expect(sample.id).toBeDefined()
    expect(sample.userId).toBe(testUser.id)
    expect(sample.labelStatus).toBe('unreviewed')
  })

  it('rejects an unknown label instead of storing it', async () => {
    const res = await request('/samples', jsonBody({
      input: '随便一句',
      group: 'chitchat',
      expected: 'maybe',
    }))

    expect(res.status).toBe(400)
  })

  it('imports a batch in one request', async () => {
    const res = await request('/samples/import', jsonBody({
      samples: [
        { input: '现在还是这样', context: [{ role: 'user', content: '大量出血' }], group: 'medical-implicit', expected: 'medical' },
        { input: '今天天气不错', group: 'chitchat', expected: 'chat' },
      ],
    }))

    expect(res.status).toBe(201)
    const rows = await res.json() as any[]
    expect(rows).toHaveLength(2)
    // The earlier turn is stored as an ordered array, so its role survives.
    expect(rows[0].context).toEqual([{ role: 'user', content: '大量出血' }])
  })

  it('updates the label status of an owned sample', async () => {
    const created = await request('/samples', jsonBody({
      input: '她今天特别没精神',
      group: 'medical-implicit',
      expected: 'medical',
    }))
    const sample = await created.json() as any

    const res = await request(`/samples/${sample.id}`, jsonBody({ labelStatus: 'reviewed', expected: 'chat' }, 'PATCH'))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ labelStatus: 'reviewed', expected: 'chat' })
  })

  it('does not let another user read or change a sample', async () => {
    const created = await request('/samples', jsonBody({
      input: '产后复查挂哪个科',
      group: 'hospital-process',
      expected: 'chat',
    }))
    const sample = await created.json() as any

    const theirs = await request('/samples', undefined, otherUser)
    expect(await theirs.json()).toEqual([])

    const patch = await request(`/samples/${sample.id}`, jsonBody({ expected: 'medical' }, 'PATCH'), otherUser)
    expect(patch.status).toBe(404)

    const remove = await request(`/samples/${sample.id}`, { method: 'DELETE' }, otherUser)
    expect(remove.status).toBe(404)
  })

  it('soft deletes a sample so a run keeps its snapshot', async () => {
    const created = await request('/samples', jsonBody({
      input: '宝宝吐奶',
      group: 'medical-explicit',
      expected: 'medical',
    }))
    const sample = await created.json() as any

    const res = await request(`/samples/${sample.id}`, { method: 'DELETE' })
    expect(res.status).toBe(204)

    const list = await request('/samples')
    const ids = (await list.json() as any[]).map(row => row.id)
    expect(ids).not.toContain(sample.id)
  })

  it('records a run and reports progress on it', async () => {
    const created = await request('/runs', jsonBody({
      sampleSetVersion: 7,
      mode: 'compare',
      configKey: 'compare|set7|deepseek-flash|abc12345:120',
      modelId: 'deepseek-flash',
      classifierPromptDigest: 'abc12345:120',
      total: 3,
    }))

    expect(created.status).toBe(201)
    const run = await created.json() as any
    expect(run.status).toBe('running')
    expect(run.completed).toBe(0)

    const patched = await request(`/runs/${run.id}`, jsonBody({
      completed: 3,
      status: 'completed',
      metrics: { rules: { recall: 0.5, medicalTotal: 2, chatTotal: 1 } },
      cases: [{
        sampleId: 'sample-1',
        input: '宝宝黄疸怎么看',
        expected: 'medical',
        rules: 'medical',
        model: 'medical',
        disagreement: false,
      }],
    }, 'PATCH'))

    expect(patched.status).toBe(200)
    const done = await patched.json() as any
    expect(done.status).toBe('completed')
    expect(done.completed).toBe(3)
    expect(done.finishedAt).not.toBeNull()
    expect(done.metrics.rules.recall).toBe(0.5)
    expect(done.cases).toHaveLength(1)
  })

  it('rejects a run with an unknown mode or a malformed case', async () => {
    const badMode = await request('/runs', jsonBody({
      sampleSetVersion: 1,
      mode: 'magic',
      configKey: 'x',
      total: 1,
    }))
    expect(badMode.status).toBe(400)

    const created = await request('/runs', jsonBody({
      sampleSetVersion: 1,
      mode: 'rules',
      configKey: 'rules|set1|no-model|abc:1',
      total: 1,
    }))
    const run = await created.json() as any

    const badCase = await request(`/runs/${run.id}`, jsonBody({
      cases: [{ sampleId: '', input: 'x', expected: 'medical' }],
    }, 'PATCH'))
    expect(badCase.status).toBe(400)
  })

  it('keeps runs private to their owner', async () => {
    const created = await request('/runs', jsonBody({
      sampleSetVersion: 1,
      mode: 'rules',
      configKey: 'rules|set1|no-model|abc:1',
      total: 2,
    }))
    const run = await created.json() as any

    const theirs = await request('/runs', undefined, otherUser)
    expect(await theirs.json()).toEqual([])

    const one = await request(`/runs/${run.id}`, undefined, otherUser)
    expect(one.status).toBe(404)
  })

  // The scheduler in app.ts calls this on account deletion; untested, the
  // samples and their run history would outlive the account.
  it('removes both tables for one account without touching another', async () => {
    const created = await request('/samples', jsonBody({
      input: '注销前的样本',
      group: 'chitchat',
      expected: 'chat',
    }))
    const sample = await created.json() as any

    const runRes = await request('/runs', jsonBody({
      sampleSetVersion: 1,
      mode: 'rules',
      configKey: 'rules|set1|no-model|abc:1',
      total: 1,
    }))
    const run = await runRes.json() as any

    const strangerCreated = await request('/samples', jsonBody({
      input: '别人的样本',
      group: 'chitchat',
      expected: 'chat',
    }), otherUser)
    const kept = await strangerCreated.json() as any

    const removed = await service.deleteAllForUser(testUser.id)
    expect(removed.samples).toBeGreaterThan(0)
    expect(removed.runs).toBeGreaterThan(0)

    const ownSamples = (await (await request('/samples')).json() as any[]).map(row => row.id)
    expect(ownSamples).not.toContain(sample.id)
    expect((await request(`/runs/${run.id}`)).status).toBe(404)

    const strangerSamples = (await (await request('/samples', undefined, otherUser)).json() as any[]).map(row => row.id)
    expect(strangerSamples).toContain(kept.id)
  })
  it('rejects a sample that points at a collection the caller does not own', async () => {
    const theirs = await (await request('/collections', jsonBody({ name: '别人的集合' }), otherUser)).json() as any

    const res = await request('/samples', jsonBody({
      input: '宝宝黄疸怎么看',
      group: 'medical-explicit',
      expected: 'medical',
      collectionId: theirs.id,
    }))

    expect(res.status).toBe(400)
  })
  it('creates a collection and lists only its own samples', async () => {
    const created = await request('/collections', jsonBody({ name: '开发集', purpose: 'development' }))
    expect(created.status).toBe(201)
    const collection = await created.json() as any
    expect(collection).toMatchObject({ name: '开发集', purpose: 'development' })

    await request('/samples', jsonBody({ input: '宝宝黄疸怎么看', group: 'medical-explicit', expected: 'medical', collectionId: collection.id }))
    await request('/samples', jsonBody({ input: '今天天气不错', group: 'chitchat', expected: 'chat' }))

    const inCollection = await (await request(`/samples?collectionId=${collection.id}`)).json() as any[]
    expect(inCollection).toHaveLength(1)
    expect(inCollection[0].collectionId).toBe(collection.id)

    const all = await (await request('/samples')).json() as any[]
    expect(all.length).toBeGreaterThan(inCollection.length)
  })

  it('renames a collection and hides it from another user', async () => {
    const created = await (await request('/collections', jsonBody({ name: '旧名' }))).json() as any
    const renamed = await request(`/collections/${created.id}`, jsonBody({ name: '新名' }, 'PATCH'))
    expect(renamed.status).toBe(200)
    expect((await renamed.json() as any).name).toBe('新名')

    expect((await request(`/collections/${created.id}`, jsonBody({ name: '别人的' }, 'PATCH'), otherUser)).status).toBe(404)
  })
})
