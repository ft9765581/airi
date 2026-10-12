/** One external knowledge base the user connected. */
export interface KnowledgeBaseConnection {
  id: string
  name: string
  baseUrl: string
  /**
   * The credential for this service. It stays in the page for now. A real store
   * must treat it as a secret and keep it out of logs and exports.
   */
  apiKey: string
  knowledgeBaseId: string
  /** A disabled connection stays in the list, but no request uses it. */
  enabled: boolean
}

/** The values a user typed in the new-connection form. */
export interface KnowledgeBaseDraft {
  name: string
  baseUrl: string
  apiKey: string
  knowledgeBaseId: string
}

/** The connection state a test can report. */
export type KnowledgeBaseStatus = 'untested' | 'testing' | 'connected' | 'failed'
