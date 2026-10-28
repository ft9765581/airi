import type { Env } from '../../libs/env'

import { errorMessageFrom } from '@moeru/std'

import { createBadGatewayError, createGatewayTimeoutError, createServiceUnavailableError } from '../../utils/error'

/** One graph search, already validated by the route. */
export interface KnowledgeGraphSearchInput {
  query: string
  /**
   * The maximum relations the service returns.
   *
   * Undefined forwards no `limit`, so the service applies the default it
   * documents instead of this process inventing one.
   */
  limit?: number
  /** Limits the search to one document. The service takes a `Book.id` here. */
  bookId?: string
}

/** What the upstream graph service answered. */
export interface KnowledgeGraphSearchResult {
  /** The status the upstream service returned. */
  status: number
  /** The parsed upstream body, returned unchanged. */
  body: unknown
}

/**
 * Forwards graph searches to the knowledge service this deployment uses.
 *
 * Use when:
 * - The browser needs the graph, but the service refuses its origin.
 *
 * Expects:
 * - `env.KNOWLEDGE_GRAPH_URL` names the search endpoint.
 * - `env.KNOWLEDGE_GRAPH_API_KEY` holds the key, when the service or its gateway
 *   requires one. The service reads it as `X-API-Key`.
 *
 * Returns:
 * - The upstream status and body unchanged. The browser client already explains
 *   those fields, and translating them here would give one failure two
 *   vocabularies.
 */
export function createKnowledgeGraphService(env: Env) {
  /**
   * Forwards one search over the published graph contract.
   *
   * The browser sends the same query parameters it would send to the service, so
   * switching this endpoint on or off is a deployment decision and never a client
   * change.
   */
  async function search(input: KnowledgeGraphSearchInput): Promise<KnowledgeGraphSearchResult> {
    const base = env.KNOWLEDGE_GRAPH_URL?.trim()
    if (!base)
      throw createServiceUnavailableError('Knowledge graph is not configured', 'KNOWLEDGE_GRAPH_NOT_CONFIGURED')

    let url: URL
    try {
      url = new URL(base)
    }
    catch (error) {
      throw createServiceUnavailableError('Knowledge graph URL is invalid', 'KNOWLEDGE_GRAPH_INVALID_URL', {
        message: errorMessageFrom(error),
      })
    }
    url.searchParams.set('q', input.query)
    if (input.limit !== undefined)
      url.searchParams.set('limit', String(input.limit))
    if (input.bookId)
      url.searchParams.set('book_id', input.bookId)

    let response: Response
    try {
      response = await fetch(url.toString(), {
        method: 'GET',
        headers: env.KNOWLEDGE_GRAPH_API_KEY
          ? { 'X-API-Key': env.KNOWLEDGE_GRAPH_API_KEY }
          : {},
        // A stuck upstream must not hold the caller's request open. The browser
        // applies its own 8 s budget; this one is the backstop.
        signal: AbortSignal.timeout(env.KNOWLEDGE_GRAPH_TIMEOUT_MS),
      })
    }
    catch (error) {
      if (error instanceof DOMException && error.name === 'TimeoutError') {
        throw createGatewayTimeoutError('Knowledge graph did not answer in time', {
          url: url.toString(),
          timeoutMs: env.KNOWLEDGE_GRAPH_TIMEOUT_MS,
        })
      }

      throw createBadGatewayError('Knowledge graph is unreachable', {
        url: url.toString(),
        message: errorMessageFrom(error),
      })
    }

    const body = await response.json().catch(() => undefined)
    if (body === undefined) {
      throw createBadGatewayError('Knowledge graph answered with a body this API cannot read', {
        url: url.toString(),
        status: response.status,
      })
    }

    return { status: response.status, body }
  }

  return { search }
}

export type KnowledgeGraphService = ReturnType<typeof createKnowledgeGraphService>
