import type { KnowledgeBaseConnection } from './knowledge-base'

import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { connectionScope, useSettingsKnowledgeBase } from './knowledge-base'

function connection(overrides: Partial<KnowledgeBaseConnection> = {}): KnowledgeBaseConnection {
  return {
    id: 'kb-1',
    name: '导诊库',
    baseUrl: 'https://kb.example.test/api/dify/retrieval',
    apiKey: 'kb-key',
    knowledgeBaseId: 'kb-doc',
    enabled: true,
    ...overrides,
  }
}

describe('connection scope', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  // A connection saved before the switch existed was written for the only flow
  // that read the list then, so it must keep answering that flow.
  it('reads a connection without a scope as ordinary chat', () => {
    expect(connectionScope(connection())).toBe('chat')
  })

  it('keeps each flow to the connections marked for it', () => {
    const store = useSettingsKnowledgeBase()
    store.connections = [
      connection({ id: 'chat-scoped', scope: 'chat' }),
      connection({ id: 'medical-scoped', scope: 'medical' }),
    ]

    expect(store.connectionsFor('chat').map(item => item.id)).toEqual(['chat-scoped'])
    expect(store.connectionsFor('medical').map(item => item.id)).toEqual(['medical-scoped'])
  })

  it('leaves a disabled connection out of both flows', () => {
    const store = useSettingsKnowledgeBase()
    store.connections = [
      connection({ id: 'chat-off', scope: 'chat', enabled: false }),
      connection({ id: 'medical-off', scope: 'medical', enabled: false }),
    ]

    expect(store.connectionsFor('chat')).toEqual([])
    expect(store.connectionsFor('medical')).toEqual([])
  })

  it('leaves an incomplete connection out of both flows', () => {
    const store = useSettingsKnowledgeBase()
    store.connections = [
      connection({ id: 'no-url', scope: 'medical', baseUrl: ' ' }),
      connection({ id: 'no-knowledge-id', scope: 'medical', knowledgeBaseId: '' }),
    ]

    expect(store.connectionsFor('medical')).toEqual([])
  })
})
