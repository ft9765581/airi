import type { KnowledgeGraphConnection } from './knowledge-graph'

import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { connectionScope } from './connection-scope'
import { useSettingsKnowledgeBase } from './knowledge-base'
import { useSettingsKnowledgeGraph } from './knowledge-graph'

function connection(overrides: Partial<KnowledgeGraphConnection> = {}): KnowledgeGraphConnection {
  return {
    id: 'graph-1',
    name: '妇幼导诊图谱',
    baseUrl: 'https://knowledge.example.test/api/graph/search',
    apiKey: '',
    enabled: true,
    ...overrides,
  }
}

describe('knowledge graph connections', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('reads a connection without a scope as ordinary chat', () => {
    expect(connectionScope(connection())).toBe('chat')
  })

  it('keeps each flow to the connections marked for it', () => {
    const store = useSettingsKnowledgeGraph()
    store.connections = [
      connection({ id: 'chat-scoped', scope: 'chat' }),
      connection({ id: 'medical-scoped', scope: 'medical' }),
    ]

    expect(store.connectionsFor('chat').map(item => item.id)).toEqual(['chat-scoped'])
    expect(store.connectionsFor('medical').map(item => item.id)).toEqual(['medical-scoped'])
  })

  it('leaves a disabled connection out of both flows', () => {
    const store = useSettingsKnowledgeGraph()
    store.connections = [
      connection({ id: 'chat-off', scope: 'chat', enabled: false }),
      connection({ id: 'medical-off', scope: 'medical', enabled: false }),
    ]

    expect(store.connectionsFor('chat')).toEqual([])
    expect(store.connectionsFor('medical')).toEqual([])
  })

  it('leaves a connection without an address out of both flows', () => {
    const store = useSettingsKnowledgeGraph()
    store.connections = [
      connection({ id: 'no-url', scope: 'medical', baseUrl: ' ' }),
    ]

    expect(store.connectionsFor('medical')).toEqual([])
  })

  // The book id is optional, because the service searches every published graph
  // without one. A connection that names no document is usable.
  it('keeps a connection that names no document', () => {
    const store = useSettingsKnowledgeGraph()
    store.connections = [
      connection({ id: 'no-book', scope: 'medical', bookId: undefined }),
    ]

    expect(store.connectionsFor('medical').map(item => item.id)).toEqual(['no-book'])
  })

  // A graph connection must not answer a knowledge base retrieval, and the
  // reverse must not happen either. Both kinds live on one settings page, so the
  // only thing that keeps them apart is their own store.
  it('keeps its list apart from the knowledge base list', () => {
    const graph = useSettingsKnowledgeGraph()
    graph.connections = [connection()]

    expect(useSettingsKnowledgeBase().connections).toEqual([])
  })
})
