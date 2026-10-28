import type { ConnectionScope } from './connection-scope'

import { useLocalStorageManualReset } from '@proj-airi/stage-shared/composables'
import { defineStore } from 'pinia'

import { connectionScope } from './connection-scope'

/** One external knowledge graph connection. */
export interface KnowledgeGraphConnection {
  id: string
  name: string
  /** The graph search endpoint address. */
  baseUrl: string
  /**
   * The credential for the endpoint.
   *
   * The graph search endpoint reads it as `X-API-Key`, and the deployment's
   * gateway leaves the value empty while the service needs no key.
   *
   * NOTICE:
   * The value lives in browser storage in clear text, the same way the provider
   * keys of this app and the knowledge base keys do. A script on this origin can
   * read it, and another user of this browser profile can read it. A key that
   * must stay secret from the user of this browser does not belong here. A
   * production deployment routes the query through a server that holds the key
   * instead.
   */
  apiKey: string
  /**
   * Limits the search to one document, as the service's `book_id`.
   *
   * The service expects a `Book.id` here, not a knowledge base id. Empty searches
   * every published graph, which is the normal setting.
   */
  bookId?: string
  /** A disabled connection stays in the list, but no send uses it. */
  enabled: boolean
  /** The flow this connection answers. */
  scope?: ConnectionScope
}

/** The values a user typed in the connection form. */
export interface KnowledgeGraphDraft {
  name: string
  baseUrl: string
  apiKey: string
  bookId: string
  scope: ConnectionScope
}

/**
 * The knowledge graph connections of this browser.
 *
 * The settings page owns the writes and the connection test. No chat turn reads
 * this list yet, so a connection here is a saved address that a later graph
 * retrieval can pick up by scope, the same way the knowledge base list works.
 */
export const useSettingsKnowledgeGraph = defineStore('settings-knowledge-graph', () => {
  const connections = useLocalStorageManualReset<KnowledgeGraphConnection[]>(
    'settings/knowledge-graph/connections',
    [],
  )

  /**
   * The connections one flow may use.
   *
   * A connection without an address cannot answer a query, so the filter drops it
   * before a caller reaches the network. The document id is optional: the service
   * searches every published graph without one.
   */
  function connectionsFor(scope: ConnectionScope): KnowledgeGraphConnection[] {
    return connections.value.filter(connection =>
      connection.enabled
      && connectionScope(connection) === scope
      && !!connection.baseUrl.trim(),
    )
  }

  function resetState() {
    connections.reset()
  }

  return {
    connections,
    connectionsFor,
    resetState,
  }
})
