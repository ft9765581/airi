import { useLocalStorageManualReset } from '@proj-airi/stage-shared/composables'
import { defineStore } from 'pinia'

/** The chat flow a connection answers. */
export type KnowledgeBaseScope = 'chat' | 'medical'

/** One external knowledge base connection. */
export interface KnowledgeBaseConnection {
  id: string
  name: string
  /** The retrieval endpoint address. */
  baseUrl: string
  /**
   * The credential for the endpoint.
   *
   * NOTICE:
   * The value lives in browser storage in clear text, the same way the provider
   * keys of this app do. A script on this origin can read it, and another user
   * of this browser profile can read it. A key that must stay secret from the
   * user of this browser does not belong here. A production deployment routes
   * retrieval through a server that holds the key instead.
   */
  apiKey: string
  /** The `knowledge_id` the retrieval endpoint expects. */
  knowledgeBaseId: string
  /** A disabled connection stays in the list, but no send uses it. */
  enabled: boolean
  /**
   * The flow this connection answers.
   *
   * NOTICE:
   * A connection saved before this switch existed has no value. It keeps
   * answering ordinary chat, which was the only flow that read the list when it
   * was written. Remove the default in `connectionScope` once the settings page
   * has written a scope for every stored connection.
   */
  scope?: KnowledgeBaseScope
}

/** The values a user typed in the connection form. */
export interface KnowledgeBaseDraft {
  name: string
  baseUrl: string
  apiKey: string
  knowledgeBaseId: string
  scope: KnowledgeBaseScope
}

/**
 * The scope a stored connection answers.
 *
 * The default exists for connections written before the switch. Only ordinary
 * chat read the list then, so that is the flow they were configured for.
 *
 * @example
 * connectionScope({ ...connection, id: '1', name: 'x', baseUrl: 'y', apiKey: '', knowledgeBaseId: 'z', enabled: true })
 * // => 'chat'
 */
export function connectionScope(connection: KnowledgeBaseConnection): KnowledgeBaseScope {
  return connection.scope ?? 'chat'
}

/**
 * The knowledge base connections of this browser.
 *
 * The settings page owns the writes. A flow reads `connectionsFor` on the turn
 * that needs a retrieval: ordinary chat through a runtime context provider, the
 * medical branch through the router.
 */
export const useSettingsKnowledgeBase = defineStore('settings-knowledge-base', () => {
  const connections = useLocalStorageManualReset<KnowledgeBaseConnection[]>(
    'settings/knowledge-base/connections',
    [],
  )

  /**
   * The connections one flow may use.
   *
   * A connection without an address or a knowledge id cannot answer a
   * retrieval, so the filter drops it before the turn reaches the network.
   */
  function connectionsFor(scope: KnowledgeBaseScope): KnowledgeBaseConnection[] {
    return connections.value.filter(connection =>
      connection.enabled
      && connectionScope(connection) === scope
      && !!connection.baseUrl.trim()
      && !!connection.knowledgeBaseId.trim(),
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
