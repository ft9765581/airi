import type { Env } from '../../libs/env'
import type { HonoEnv } from '../../types/hono'

import { Hono } from 'hono'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createKnowledgeGraphRoutes } from '.'
import { createKnowledgeGraphService } from '../../services/domain/knowledge-graph'
import { ApiError } from '../../utils/error'

/** The Node signature of `fetch`; the server codebase does not load the DOM lib. */
type FetchHandler = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

const configuredEnv = {
  KNOWLEDGE_GRAPH_URL: 'https://knowledge.example.test/api/graph/search',
  KNOWLEDGE_GRAPH_API_KEY: 'graph-key',
  KNOWLEDGE_GRAPH_TIMEOUT_MS: 8000,
} as unknown as Env

const testUser = { id: 'user-1', email: 'test@example.com', name: 'Test User' }

/** One relation, shaped as the published contract describes it. */
const upstreamBody = {
  query: '发热',
  mode: 'lexical',
  fallback_reason: 'semantic_index_unavailable',
  total: 1,
  results: [{
    source_node_id: 'note:wiki-1',
    source_title: '仅有经期发热',
    relation_type: 'DERIVED_FROM',
    target_node_id: 'document:2',
    target_title: '临床诊疗指南-妇产科学分册',
    evidence: '分段 blk-1（原文片段）',
    weight: 1,
  }],
}

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

  app.route('/', createKnowledgeGraphRoutes(createKnowledgeGraphService(env)))
  return app
}

function search(app: Hono<HonoEnv>, query = 'q=%E5%8F%91%E7%83%AD&limit=5', withUser = true) {
  return app.fetch(new Request(`http://localhost/search?${query}`), (withUser ? { user: testUser } : {}) as never)
}

function upstreamResponse(body: unknown = upstreamBody, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/**
 * Replaces the global `fetch` so a test can read the forwarded request.
 *
 * The handler builds a fresh `Response` per call: a body can be read only once, so
 * a shared response would fail on the second call for reasons the test is not
 * about.
 */
function stubFetch(handler: FetchHandler) {
  const fetchMock = vi.fn(handler)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('knowledge graph search proxy', () => {
  // The graph service needs no key, so this route protects no secret and does not
  // require a session. A visitor who never signs in must still reach the graph.
  it('answers a caller without a session', async () => {
    stubFetch(async () => upstreamResponse())

    const res = await search(buildApp(), undefined, false)

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(upstreamBody)
  })

  it('forwards the search parameters with the deployment key and returns the body unchanged', async () => {
    const fetchMock = stubFetch(async () => upstreamResponse())

    const res = await search(buildApp())

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(upstreamBody)

    const [url, init] = fetchMock.mock.calls[0]!
    const forwarded = new URL(String(url))
    expect(forwarded.origin).toBe('https://knowledge.example.test')
    expect(forwarded.pathname).toBe('/api/graph/search')
    expect(forwarded.searchParams.get('q')).toBe('发热')
    expect(forwarded.searchParams.get('limit')).toBe('5')
    // The graph contract reads the key from `X-API-Key`, not from `Authorization`.
    // `Headers` reads the forwarded init without indexing after an optional chain.
    expect(new Headers(init?.headers).get('X-API-Key')).toBe('graph-key')
    expect(init?.method).toBe('GET')
  })

  it('forwards the document id only when the caller names one', async () => {
    const fetchMock = stubFetch(async () => upstreamResponse())

    await search(buildApp(), 'q=%E5%8F%91%E7%83%AD&limit=1&book_id=f8e6b441')
    expect(new URL(String(fetchMock.mock.calls[0]?.[0])).searchParams.get('book_id')).toBe('f8e6b441')

    await search(buildApp(), 'q=%E5%8F%91%E7%83%AD&limit=1')
    expect(new URL(String(fetchMock.mock.calls[1]?.[0])).searchParams.has('book_id')).toBe(false)
  })

  // An absent limit stays absent: the service documents its own default, and two
  // defaults in a chain must not disagree.
  it('forwards no limit when the caller sends none', async () => {
    const fetchMock = stubFetch(async () => upstreamResponse())

    await search(buildApp(), 'q=%E5%8F%91%E7%83%AD')

    expect(new URL(String(fetchMock.mock.calls[0]?.[0])).searchParams.has('limit')).toBe(false)
  })

  it('rejects a request without a query', async () => {
    const res = await search(buildApp(), 'limit=5')
    expect(res.status).toBe(400)
  })

  // The service documents 1 to 50. A larger value would let one caller pull the
  // whole graph, and a fractional one would reach the service as a float.
  it('rejects a limit outside the documented bounds', async () => {
    stubFetch(async () => upstreamResponse())

    expect((await search(buildApp(), 'q=%E5%8F%91%E7%83%AD&limit=1')).status).toBe(200)
    expect((await search(buildApp(), 'q=%E5%8F%91%E7%83%AD&limit=50')).status).toBe(200)
    expect((await search(buildApp(), 'q=%E5%8F%91%E7%83%AD&limit=0')).status).toBe(400)
    expect((await search(buildApp(), 'q=%E5%8F%91%E7%83%AD&limit=51')).status).toBe(400)
    expect((await search(buildApp(), 'q=%E5%8F%91%E7%83%AD&limit=2.5')).status).toBe(400)
    expect((await search(buildApp(), 'q=%E5%8F%91%E7%83%AD&limit=abc')).status).toBe(400)
  })

  it('answers 503 when the deployment has no graph configured', async () => {
    const unconfigured = { ...configuredEnv, KNOWLEDGE_GRAPH_URL: undefined } as unknown as Env
    const res = await search(buildApp(unconfigured))

    expect(res.status).toBe(503)
    expect((await res.json() as { error: string }).error).toBe('KNOWLEDGE_GRAPH_NOT_CONFIGURED')
  })

  it('answers 503 when the configured graph URL is invalid', async () => {
    const invalidEnv = { ...configuredEnv, KNOWLEDGE_GRAPH_URL: 'not a URL' } as unknown as Env
    const res = await search(buildApp(invalidEnv))

    expect(res.status).toBe(503)
    expect((await res.json() as { error: string }).error).toBe('KNOWLEDGE_GRAPH_INVALID_URL')
  })

  it('answers 502 when the upstream service is unreachable', async () => {
    stubFetch(async () => {
      throw new TypeError('fetch failed')
    })

    const res = await search(buildApp())
    expect(res.status).toBe(502)
  })

  it('answers 502 when the upstream body is not JSON', async () => {
    stubFetch(async () => new Response('<html>oops</html>', { status: 200 }))
    const res = await search(buildApp())
    expect(res.status).toBe(502)
  })

  it('passes an upstream failure status through', async () => {
    stubFetch(async () => upstreamResponse({ detail: 'Bad Request' }, 400))
    const res = await search(buildApp())
    expect(res.status).toBe(400)
  })
})
