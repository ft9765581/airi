import { KNOWLEDGE_BASE_RETRIEVAL_PATH, SERVER_URL } from '@proj-airi/stage-ui/libs/server'

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
/**
 * The path this app's dev server forwards to the knowledge base.
 *
 * The service rejects most browser origins. The development proxy forwards
 * requests while the local backend is optional.
 */
const devProxyPath = '/knowledge-base-dev/api/dify/retrieval'

function resolveDefaultServerUrl(): string {
  if (import.meta.env.VITE_KNOWLEDGE_BASE_URL)
    return import.meta.env.VITE_KNOWLEDGE_BASE_URL

  if (import.meta.env.DEV && typeof window !== 'undefined')
    return `${window.location.origin}${devProxyPath}`

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
