import type { Env } from '../../libs/env'
import type { HonoEnv } from '../../types/hono'

import { Hono } from 'hono'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createKnowledgeBaseRoutes } from '.'
import { createKnowledgeBaseService } from '../../services/domain/knowledge-base'
import { ApiError } from '../../utils/error'

const configuredEnv = {
  KNOWLEDGE_BASE_URL: 'https://kb.example.test/api/dify/retrieval',
  KNOWLEDGE_BASE_API_KEY: 'kb-key',
  KNOWLEDGE_BASE_TIMEOUT_MS: 8000,
} as unknown as Env

const testUser = { id: 'user-1', email: 'test@example.com', name: 'Test User' }

function buildApp(env: Env = configuredEnv) {
  const app = new Hono<HonoEnv>()

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

  app.use('*', async (c, next) => {
    const user = (c.env as { user?: unknown })?.user
    if (user)
      c.set('user', user as HonoEnv['Variables']['user'])
    await next()
  })

  app.route('/', createKnowledgeBaseRoutes(createKnowledgeBaseService(env)))
  return app
}

function post(app: Hono<HonoEnv>, body: unknown, withUser = true) {
  return app.fetch(new Request('http://localhost/retrieval', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  }), (withUser ? { user: testUser } : {}) as never)
}

const validBody = {
  knowledge_id: 'postpartum',
  query: '涨奶怎么办',
  retrieval_setting: { top_k: 3, score_threshold: 0 },
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('knowledge base retrieval proxy', () => {
  it('requires a signed-in user', async () => {
    const app = buildApp()
    const res = await post(app, validBody, false)
    expect(res.status).toBe(401)
  })

  it('forwards the Dify contract with the deployment key and returns the body unchanged', async () => {
    const upstream = { records: [{ content: '温毛巾热敷 3~5 分钟', score: 0.83 }] }
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(upstream), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    const res = await post(buildApp(), validBody)

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(upstream)

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://kb.example.test/api/dify/retrieval')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer kb-key')
    expect(JSON.parse(init.body as string)).toEqual({
      knowledge_id: 'postpartum',
      query: '涨奶怎么办',
      retrieval_setting: { top_k: 3, score_threshold: 0 },
    })
  })

  it('passes an upstream error code through instead of rewriting it', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ error_code: 2001, error_msg: '知识库不存在' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )))

    const res = await post(buildApp(), validBody)

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ error_code: 2001, error_msg: '知识库不存在' })
  })

  it('rejects a body that does not follow the contract', async () => {
    const res = await post(buildApp(), { knowledge_id: '', query: '' })
    expect(res.status).toBe(400)
  })

  it('answers 503 when the deployment has no knowledge base configured', async () => {
    const unconfigured = { ...configuredEnv, KNOWLEDGE_BASE_URL: undefined } as unknown as Env
    const res = await post(buildApp(unconfigured), validBody)

    expect(res.status).toBe(503)
    expect((await res.json() as { error: string }).error).toBe('KNOWLEDGE_BASE_NOT_CONFIGURED')
  })

  it('answers 502 when the upstream service is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')))
    const res = await post(buildApp(), validBody)
    expect(res.status).toBe(502)
  })

  it('answers 502 when the upstream body is not JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>oops</html>', { status: 200 })))
    const res = await post(buildApp(), validBody)
    expect(res.status).toBe(502)
  })
})
