import type { KnowledgeGraphRequestInput } from './knowledge-graph'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { requestKnowledgeGraphSearch } from './knowledge-graph'

type FetchHandler = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

/** One relation entry, shaped as the published contract describes it. */
function relation(overrides: Record<string, unknown> = {}) {
  return {
    source_node_id: 'note:wiki-1',
    source_title: '仅有经期发热',
    relation_type: 'DERIVED_FROM',
    target_node_id: 'document:2',
    target_title: '临床诊疗指南-妇产科学分册',
    evidence: '分段 blk-1（原文片段）',
    weight: 1,
    context_kind: 'relation',
    ...overrides,
  }
}

function graphSearch(overrides: Partial<KnowledgeGraphRequestInput> = {}): KnowledgeGraphRequestInput {
  return {
    baseUrl: 'https://knowledge.example.test/api/graph/search',
    query: '发热',
    ...overrides,
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

/** Replaces the global `fetch` so a test can read the request it received. */
function stubFetch(handler: FetchHandler) {
  const fetchMock = vi.fn(handler)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function requestedUrl(call: [RequestInfo | URL, RequestInit?] | undefined): URL {
  return new URL(String(call?.[0]))
}

describe('requestKnowledgeGraphSearch', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sends the search as a GET with the published query parameters', async () => {
    const fetchMock = stubFetch(async () => jsonResponse({ total: 0, results: [] }))

    await requestKnowledgeGraphSearch(graphSearch({ query: '妊娠期高血压', limit: 3 }))

    const call = fetchMock.mock.calls[0]
    expect(call?.[1]?.method).toBe('GET')
    expect(call?.[1]?.body).toBeUndefined()

    const url = requestedUrl(call)
    expect(url.pathname).toBe('/api/graph/search')
    expect(url.searchParams.get('q')).toBe('妊娠期高血压')
    expect(url.searchParams.get('limit')).toBe('3')
  })

  // `book_id` limits the search to one document. An empty value must leave the
  // parameter out, or the service receives a document id that names nothing.
  it('leaves out the document id when the connection names none', async () => {
    const fetchMock = stubFetch(async () => jsonResponse({ total: 0, results: [] }))

    await requestKnowledgeGraphSearch(graphSearch({ bookId: '  ' }))

    expect(requestedUrl(fetchMock.mock.calls[0]).searchParams.has('book_id')).toBe(false)
  })

  it('sends the document id when the connection names one', async () => {
    const fetchMock = stubFetch(async () => jsonResponse({ total: 0, results: [] }))

    await requestKnowledgeGraphSearch(graphSearch({ bookId: 'f8e6b441' }))

    expect(requestedUrl(fetchMock.mock.calls[0]).searchParams.get('book_id')).toBe('f8e6b441')
  })

  // The graph contract reads the key from `X-API-Key`, not from `Authorization`.
  // The retrieval contract of the same service reads the other header.
  it('sends the connection key as X-API-Key', async () => {
    const fetchMock = stubFetch(async () => jsonResponse({ total: 0, results: [] }))

    await requestKnowledgeGraphSearch(graphSearch({ apiKey: 'graph-key' }))

    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers)
    expect(headers.get('X-API-Key')).toBe('graph-key')
    expect(headers.get('Authorization')).toBeNull()
  })

  it('reads the relations and the reported count', async () => {
    stubFetch(async () => jsonResponse({
      query: '发热',
      mode: 'lexical',
      total: 3,
      results: [relation()],
    }))

    const response = await requestKnowledgeGraphSearch(graphSearch())

    expect(response.ok).toBe(true)
    expect(response.total).toBe(3)
    expect(response.mode).toBe('lexical')
    expect(response.relations).toEqual([{
      sourceTitle: '仅有经期发热',
      relationType: 'DERIVED_FROM',
      targetTitle: '临床诊疗指南-妇产科学分册',
      evidence: '分段 blk-1（原文片段）',
      weight: 1,
    }])
  })

  it('drops a relation the contract does not name', async () => {
    stubFetch(async () => jsonResponse({
      total: 2,
      results: [relation({ relation_type: undefined }), relation({ source_title: '可用的关系' })],
    }))

    const response = await requestKnowledgeGraphSearch(graphSearch())

    expect(response.relations.map(item => item.sourceTitle)).toEqual(['可用的关系'])
  })

  it('counts an answer with no relations as zero', async () => {
    stubFetch(async () => jsonResponse({ total: 0, results: [] }))

    const response = await requestKnowledgeGraphSearch(graphSearch())

    expect(response.ok).toBe(true)
    expect(response.total).toBe(0)
    expect(response.relations).toEqual([])
  })

  // Unlike retrieval, the search endpoint reports a failure with a status code
  // instead of an error code inside a successful body.
  it('reports an HTTP failure status as a failure', async () => {
    stubFetch(async () => jsonResponse({ detail: 'Not Found' }, 404))

    const response = await requestKnowledgeGraphSearch(graphSearch())

    expect(response.ok).toBe(false)
    expect(response.httpStatus).toBe(404)
  })

  it('adds a scheme to a bare host', async () => {
    const fetchMock = stubFetch(async () => jsonResponse({ total: 0, results: [] }))

    await requestKnowledgeGraphSearch(graphSearch({ baseUrl: 'knowledge.example.test/api/graph/search' }))

    expect(requestedUrl(fetchMock.mock.calls[0]).origin).toBe('https://knowledge.example.test')
  })

  it('reports an invalid address as a failed connection', async () => {
    const response = await requestKnowledgeGraphSearch(graphSearch({ baseUrl: 'https://invalid host/search' }))

    expect(response.ok).toBe(false)
    expect(response.failureKind).toBe('unreachable')
  })

  it('reports a host that never answers as unreachable', async () => {
    stubFetch(async () => {
      throw new TypeError('Failed to fetch')
    })

    const response = await requestKnowledgeGraphSearch(graphSearch())

    expect(response.ok).toBe(false)
    expect(response.failureKind).toBe('unreachable')
  })

  // ROOT CAUSE:
  //
  // A blocked cross-origin request and an unreachable host both reject with
  // `TypeError: Failed to fetch`, so the first request alone cannot name the
  // cause. `requestService` sends a second request in `no-cors` mode. That
  // request resolves when the host answers, which proves that only the
  // cross-origin rule stopped the first one. The graph service currently allows
  // no browser origin, so this is the failure a real deployment hits first.
  it('reports a host that answers the probe as blocked by the origin rule', async () => {
    let calls = 0
    stubFetch(async () => {
      calls += 1
      if (calls === 1)
        throw new TypeError('Failed to fetch')

      return new Response('', { status: 200 })
    })

    const response = await requestKnowledgeGraphSearch(graphSearch())

    expect(response.failureKind).toBe('blocked-origin')
  })
})
