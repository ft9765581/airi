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
export const defaultKnowledgeBaseServerUrl
  = import.meta.env.VITE_KNOWLEDGE_BASE_URL || 'https://knowledge.bestmings.com/api/dify/retrieval'

export const defaultKnowledgeBaseApiKey
  = import.meta.env.VITE_KNOWLEDGE_BASE_API_KEY || ''
