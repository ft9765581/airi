import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useSettingsKnowledgeBase } from '../../settings/knowledge-base'
import { useSettingsKnowledgeGraph } from '../../settings/knowledge-graph'
import { retrieveMedicalReferenceContext } from './medical-references'

type FetchHandler = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

const knowledgeBaseUrl = 'https://kb.example.test/api/dify/retrieval'
const graphUrl = 'https://graph.example.test/api/graph/search'

/** Answers the two contracts, and fails the one the test names. */
function stubServices(failure: 'none' | 'graph' | 'knowledge-base' = 'none') {
  const handler: FetchHandler = async (input) => {
    const url = String(input)

    if (url.startsWith(graphUrl)) {
      if (failure === 'graph')
        return new Response(JSON.stringify({ detail: 'Bad Gateway' }), { status: 502 })

      return new Response(JSON.stringify({
        total: 1,
        results: [{
          source_title: '仅有经期发热',
          relation_type: 'DERIVED_FROM',
          target_title: '临床诊疗指南-妇产科学分册',
          evidence: '分段 blk-1',
        }],
      }), { status: 200 })
    }

    if (failure === 'knowledge-base')
      return new Response(JSON.stringify({ error_code: 2001 }), { status: 200 })

    return new Response(JSON.stringify({
      records: [{ content: '温毛巾热敷 3~5 分钟', score: 0.8 }],
    }), { status: 200 })
  }

  vi.stubGlobal('fetch', vi.fn(handler))
}

function useBothConnections() {
  useSettingsKnowledgeBase().connections = [{
    id: 'kb-1',
    name: '医疗知识库',
    baseUrl: knowledgeBaseUrl,
    apiKey: '',
    knowledgeBaseId: 'kb-medical',
    enabled: true,
    scope: 'medical',
  }]

  useSettingsKnowledgeGraph().connections = [{
    id: 'graph-1',
    name: '妇幼导诊图谱',
    baseUrl: graphUrl,
    apiKey: '',
    enabled: true,
    scope: 'medical',
  }]
}

describe('retrieveMedicalReferenceContext', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('carries the passages and the relations in one block', async () => {
    useBothConnections()
    stubServices()

    const context = await retrieveMedicalReferenceContext('产后多久可以洗澡')

    expect(context?.contextId).toBe('system:medical-reference')
    expect(context?.text).toContain('温毛巾热敷 3~5 分钟')
    expect(context?.text).toContain('仅有经期发热 —DERIVED_FROM→ 临床诊疗指南-妇产科学分册')
  })

  // A graph that is down costs its own section: the consultation still quotes the
  // passages it did read.
  it('keeps the passages when the graph fails', async () => {
    useBothConnections()
    stubServices('graph')

    const context = await retrieveMedicalReferenceContext('产后多久可以洗澡')

    expect(context?.text).toContain('温毛巾热敷 3~5 分钟')
    expect(context?.text).not.toContain('—DERIVED_FROM→')
  })

  it('keeps the relations when the knowledge base fails', async () => {
    useBothConnections()
    stubServices('knowledge-base')

    const context = await retrieveMedicalReferenceContext('产后多久可以洗澡')

    expect(context?.text).toContain('—DERIVED_FROM→')
    expect(context?.text).not.toContain('温毛巾热敷')
  })

  it('answers null when neither source has a connection', async () => {
    stubServices()

    expect(await retrieveMedicalReferenceContext('产后多久可以洗澡')).toBeNull()
  })
})
