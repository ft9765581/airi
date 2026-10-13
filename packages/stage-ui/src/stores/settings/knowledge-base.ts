import { useLocalStorageManualReset } from '@proj-airi/stage-shared/composables'
import { defineStore } from 'pinia'
import { computed } from 'vue'

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
}

/** The values a user typed in the connection form. */
export interface KnowledgeBaseDraft {
  name: string
  baseUrl: string
  apiKey: string
  knowledgeBaseId: string
}

/**
 * The knowledge base connections of this browser.
 *
 * The settings page owns the writes. The retrieval context provider reads
 * `enabledConnections` on every send.
 */
export const useSettingsKnowledgeBase = defineStore('settings-knowledge-base', () => {
  const connections = useLocalStorageManualReset<KnowledgeBaseConnection[]>(
    'settings/knowledge-base/connections',
    [],
  )

  /**
   * The connections a send can use.
   *
   * A connection without an address or a knowledge id cannot answer a
   * retrieval, so the filter drops it before the send reaches the network.
   */
  const enabledConnections = computed(() => connections.value.filter(connection =>
    connection.enabled
    && !!connection.baseUrl.trim()
    && !!connection.knowledgeBaseId.trim(),
  ))

  function resetState() {
    connections.reset()
  }

  return {
    connections,
    enabledConnections,
    resetState,
  }
})
