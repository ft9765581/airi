import type { Env } from '../../libs/env'

import { errorMessageFrom } from '@moeru/std'

import { createBadGatewayError, createGatewayTimeoutError, createServiceUnavailableError } from '../../utils/error'

/** One retrieval request, already validated by the route. */
export interface KnowledgeBaseRetrievalInput {
  knowledgeId: string
  query: string
  topK: number
  scoreThreshold: number
}

/** What the upstream knowledge base answered. */
export interface KnowledgeBaseRetrievalResult {
  /** The status the upstream service returned. */
  status: number
  /** The parsed upstream body, returned unchanged. */
  body: unknown
}

/**
 * Forwards retrieval requests to the knowledge base this deployment uses.
 *
 * Use when:
 * - The browser needs retrieval, but the knowledge base refuses its origin or its
 *   key must not reach the bundle.
 *
 * Expects:
 * - `env.KNOWLEDGE_BASE_URL` names the Dify external knowledge base endpoint.
 * - `env.KNOWLEDGE_BASE_API_KEY` holds the credential, when the service requires
 *   one.
 *
 * Returns:
 * - The upstream status and body unchanged. The browser client already explains
 *   the upstream `error_code` values, and translating them here would give one
 *   failure two vocabularies.
 */
export function createKnowledgeBaseService(env: Env) {
  async function retrieve(input: KnowledgeBaseRetrievalInput): Promise<KnowledgeBaseRetrievalResult> {
    const url = env.KNOWLEDGE_BASE_URL?.trim()
    if (!url)
      throw createServiceUnavailableError('Knowledge base is not configured', 'KNOWLEDGE_BASE_NOT_CONFIGURED')

    let response: Response
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(env.KNOWLEDGE_BASE_API_KEY ? { Authorization: `Bearer ${env.KNOWLEDGE_BASE_API_KEY}` } : {}),
        },
        body: JSON.stringify({
          knowledge_id: input.knowledgeId,
          query: input.query,
          retrieval_setting: {
            top_k: input.topK,
            score_threshold: input.scoreThreshold,
          },
        }),
        // A stuck upstream must not hold the caller's request open. The browser
        // applies its own 8 s budget; this one is the backstop.
        signal: AbortSignal.timeout(env.KNOWLEDGE_BASE_TIMEOUT_MS),
      })
    }
    catch (error) {
      if (error instanceof DOMException && error.name === 'TimeoutError') {
        throw createGatewayTimeoutError('Knowledge base did not answer in time', {
          url,
          timeoutMs: env.KNOWLEDGE_BASE_TIMEOUT_MS,
        })
      }

      throw createBadGatewayError('Knowledge base is unreachable', {
        url,
        message: errorMessageFrom(error),
      })
    }

    const body = await response.json().catch(() => undefined)
    if (body === undefined) {
      throw createBadGatewayError('Knowledge base answered with a body this API cannot read', {
        url,
        status: response.status,
      })
    }

    return { status: response.status, body }
  }

  return { retrieve }
}

export type KnowledgeBaseService = ReturnType<typeof createKnowledgeBaseService>
