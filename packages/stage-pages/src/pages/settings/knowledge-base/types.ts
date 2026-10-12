/** One external knowledge base the user connected. */
export interface KnowledgeBaseConnection {
  id: string
  name: string
  baseUrl: string
  knowledgeBaseId: string
}

/** The values a user typed in the new-connection form. */
export interface KnowledgeBaseDraft {
  name: string
  baseUrl: string
  apiKey: string
  knowledgeBaseId: string
}
