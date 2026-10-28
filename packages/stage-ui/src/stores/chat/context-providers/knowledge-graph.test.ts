import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useSettingsKnowledgeGraph } from '../../settings/knowledge-graph'
import { retrieveKnowledgeGraphContext } from './knowledge-graph'

type FetchHandler = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

function graphRelation(overrides: Record<string, unknown> = {}) {
  return {
    source_title: '仅有经期发热',
    relation_type: 'DERIVED_FROM',
    target_title: '临床诊疗指南-妇产科学分册',
    evidence: '分段 blk-1',
    weight: 1,
    ...overrides,
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

function stubFetch(handler: FetchHandler) {
  const fetchMock = vi.fn(handler)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function useGraph(overrides: Record<string, unknown> = {}) {
  const store = useSettingsKnowledgeGraph()
  store.connections = [{
    id: 'graph-1',
    name: '妇幼导诊图谱',
    baseUrl: 'https://graph.example.test/api/graph/search',
    apiKey: '',
    enabled: true,
    scope: 'medical',
    ...overrides,
  }]
  return store
}

describe('retrieveKnowledgeGraphContext', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders each relation as source, relation type and target', async () => {
    useGraph()
    stubFetch(async () => jsonResponse({ total: 1, mode: 'lexical', results: [graphRelation()] }))

    const context = await retrieveKnowledgeGraphContext('产后多久可以洗澡', 'medical')

    expect(context?.contextId).toBe('system:knowledge-graph')
    expect(context?.text).toContain('妇幼导诊图谱')
    expect(context?.text).toContain('仅有经期发热 —DERIVED_FROM→ 临床诊疗指南-妇产科学分册')
  })

  // The service sends a locator (`分段 blk-…`), not the passage text. A line that
  // carried it would look like a quoted sentence the reply does not hold.
  it('keeps the passage locator out of the prompt', async () => {
    useGraph()
    stubFetch(async () => jsonResponse({ total: 1, results: [graphRelation()] }))

    const context = await retrieveKnowledgeGraphContext('产后多久可以洗澡', 'medical')

    expect(context?.text).not.toContain('分段 blk-1')
  })

  it('reads only the connections of the flow it was asked for', async () => {
    useGraph({ scope: 'chat' })
    const fetchMock = stubFetch(async () => jsonResponse({ total: 0, results: [] }))

    const context = await retrieveKnowledgeGraphContext('产后多久可以洗澡', 'medical')

    expect(context).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reads no graph when the connection is disabled', async () => {
    useGraph({ enabled: false })
    const fetchMock = stubFetch(async () => jsonResponse({ total: 0, results: [] }))

    expect(await retrieveKnowledgeGraphContext('产后多久可以洗澡', 'medical')).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('keeps one copy of a relation that two graphs both hold', async () => {
    const store = useSettingsKnowledgeGraph()
    store.connections = [
      { id: 'a', name: '图谱甲', baseUrl: 'https://a.example.test/search', apiKey: '', enabled: true, scope: 'medical' },
      { id: 'b', name: '图谱乙', baseUrl: 'https://b.example.test/search', apiKey: '', enabled: true, scope: 'medical' },
    ]
    stubFetch(async () => jsonResponse({ total: 1, results: [graphRelation()] }))

    const context = await retrieveKnowledgeGraphContext('产后多久可以洗澡', 'medical')

    expect(context?.text.match(/仅有经期发热 —DERIVED_FROM→/g)).toHaveLength(1)
  })

  // A failed lookup costs the references, not the answer: the caller treats null
  // as "this turn has no references".
  it('answers null when the service fails', async () => {
    useGraph()
    stubFetch(async () => jsonResponse({ detail: 'Bad Gateway' }, 502))

    expect(await retrieveKnowledgeGraphContext('产后多久可以洗澡', 'medical')).toBeNull()
  })

  it('answers null when no connection exists', async () => {
    const context = await retrieveKnowledgeGraphContext('产后多久可以洗澡', 'medical')
    expect(context).toBeNull()
  })

  it('asks for nothing on an empty message', async () => {
    useGraph()
    const fetchMock = stubFetch(async () => jsonResponse({ total: 0, results: [] }))

    expect(await retrieveKnowledgeGraphContext('   ', 'medical')).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
