import type { KnowledgeBaseRequestInput } from './knowledge-base'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { requestKnowledgeBaseRetrieval } from './knowledge-base'

type FetchHandler = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

function requestBody(init?: RequestInit): Record<string, unknown> {
  return JSON.parse(String(init?.body))
}

function retrieval(overrides: Partial<KnowledgeBaseRequestInput> = {}): KnowledgeBaseRequestInput {
  return {
    baseUrl: 'https://kb.example.test/api/dify/retrieval',
    knowledgeBaseId: 'kb-doc',
    query: '小儿发热',
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

describe('requestKnowledgeBaseRetrieval', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reads the records the service returns', async () => {
    stubFetch(async () => jsonResponse({
      records: [
        { content: '第一条', score: 0.7, title: '第一章' },
        { content: '第二条' },
      ],
    }))

    const response = await requestKnowledgeBaseRetrieval(retrieval())

    expect(response.ok).toBe(true)
    expect(response.records).toEqual([
      { content: '第一条', score: 0.7, title: '第一章' },
      { content: '第二条', score: undefined, title: undefined },
    ])
  })

  it('drops a record without content', async () => {
    stubFetch(async () => jsonResponse({
      records: [{ content: '' }, { title: '无正文' }, { content: '有正文' }],
    }))

    const response = await requestKnowledgeBaseRetrieval(retrieval())

    expect(response.records.map(record => record.content)).toEqual(['有正文'])
  })

  // The service reports a missing knowledge base with HTTP 200 and error code
  // 2001, so the page must read the body before it reports a working connection.
  it('treats an error code on a successful status as a failure', async () => {
    stubFetch(async () => jsonResponse({ error_code: 2001, error_msg: '知识库不存在' }))

    const response = await requestKnowledgeBaseRetrieval(retrieval())

    expect(response.ok).toBe(false)
    expect(response.serviceErrorCode).toBe(2001)
    expect(response.serviceErrorMessage).toBe('知识库不存在')
    expect(response.records).toEqual([])
  })

  it('reports an HTTP failure status as a failure', async () => {
    stubFetch(async () => jsonResponse({ error_msg: 'unauthorized' }, 401))

    const response = await requestKnowledgeBaseRetrieval(retrieval())

    expect(response.ok).toBe(false)
    expect(response.httpStatus).toBe(401)
  })

  it('sends the Dify external knowledge contract', async () => {
    const fetchMock = stubFetch(async () => jsonResponse({ records: [] }))

    await requestKnowledgeBaseRetrieval(retrieval({ knowledgeBaseId: ' kb-doc ', topK: 3, scoreThreshold: 0.5 }))

    expect(requestBody(fetchMock.mock.calls[0]?.[1])).toEqual({
      knowledge_id: 'kb-doc',
      query: '小儿发热',
      retrieval_setting: { top_k: 3, score_threshold: 0.5 },
    })
  })

  it('sends the connection key as a bearer token', async () => {
    const fetchMock = stubFetch(async () => jsonResponse({ records: [] }))

    await requestKnowledgeBaseRetrieval(retrieval({ apiKey: 'kb-key' }))

    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get('Authorization'))
      .toBe('Bearer kb-key')
  })
})
