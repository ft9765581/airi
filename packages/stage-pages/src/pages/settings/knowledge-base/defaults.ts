import { KNOWLEDGE_BASE_RETRIEVAL_PATH, KNOWLEDGE_GRAPH_SEARCH_PATH, SERVER_URL } from '@proj-airi/stage-ui/libs/server'

/**
 * The values a new connection form starts from.
 *
 * Why the split:
 * - The server URL is not a secret. A default in this file is safe.
 * - The API key is a secret. A key in this file ships inside the JavaScript
 *   bundle and stays in the git history, so it comes from the environment at
 *   build time instead. Put the value in an ignored `.env.local` file, for
 *   example `apps/stage-web/.env.local`.
 *
 * The key reaches the browser bundle through the environment. Do not set it for
 * a production build. A production build must send retrieval requests through a
 * server that holds the key.
 */
function resolveDefaultServerUrl(): string {
  if (import.meta.env.VITE_KNOWLEDGE_BASE_URL)
    return import.meta.env.VITE_KNOWLEDGE_BASE_URL

  if (import.meta.env.VITE_SERVER_URL)
    return new URL(KNOWLEDGE_BASE_RETRIEVAL_PATH, SERVER_URL).toString()

  // Standalone clients without a deployment API keep the direct endpoint.
  return 'https://knowledge.bestmings.com/api/dify/retrieval'
}

export const defaultKnowledgeBaseServerUrl = resolveDefaultServerUrl()

export const defaultKnowledgeBaseApiKey
  = import.meta.env.VITE_KNOWLEDGE_BASE_API_KEY || ''

/**
 * The `knowledge_id` this deployment retrieves from.
 *
 * The id is not a secret, but it is deployment data, so it comes from the
 * environment instead of being written into the bundle source. Empty means the
 * medical preset leaves the field for a person to fill.
 */
export const defaultKnowledgeBaseKnowledgeId
  = import.meta.env.VITE_KNOWLEDGE_BASE_ID || ''

/**
 * The values a new graph connection form starts from.
 *
 * Precedence:
 * 1. `VITE_KNOWLEDGE_GRAPH_URL`, when the deployment points the form somewhere
 *    else.
 * 2. This deployment's API, because the graph service refuses browser origins the
 *    same way its retrieval route does. A browser reaches the graph through the
 *    server that holds it.
 * 3. The documented service endpoint, for a client with no deployment API.
 *
 * The service needs no key while its `RAG_API_TOKEN` is empty, so the form starts
 * with an empty key.
 */
function resolveDefaultGraphServerUrl(): string {
  if (import.meta.env.VITE_KNOWLEDGE_GRAPH_URL)
    return import.meta.env.VITE_KNOWLEDGE_GRAPH_URL

  if (import.meta.env.VITE_SERVER_URL)
    return new URL(KNOWLEDGE_GRAPH_SEARCH_PATH, SERVER_URL).toString()

  return 'https://knowledge.bestmings.com/api/graph/search'
}

export const defaultKnowledgeGraphServerUrl = resolveDefaultGraphServerUrl()

export const defaultKnowledgeGraphApiKey
  = import.meta.env.VITE_KNOWLEDGE_GRAPH_API_KEY || ''

/**
 * The `Book.id` a new connection form starts from.
 *
 * The search covers every published graph without it, so empty is the normal
 * value. The id is not a secret, but it is deployment data, so it comes from the
 * environment instead of being written into the bundle source.
 */
export const defaultKnowledgeGraphBookId
  = import.meta.env.VITE_KNOWLEDGE_GRAPH_BOOK_ID || ''
