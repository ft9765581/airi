import type { Env } from '../../libs/env'

import { errorMessageFrom } from '@moeru/std'
import { array, number, object, optional, safeParse, string } from 'valibot'

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
  /**
   * Forwards a retrieval over the external knowledge base contract.
   *
   * The browser sends this contract already; the deployment key is added here so
   * the key never reaches the bundle.
   */
  async function retrieveDify(input: KnowledgeBaseRetrievalInput): Promise<KnowledgeBaseRetrievalResult> {
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

  /**
   * Result shape returned by the demo search route of the knowledge service.
   *
   * Only the fields this proxy reads are declared: the response also carries
   * page locators and citation blocks that the chat prompt never uses.
   */
  const DemoSearchResponseSchema = object({
    results: optional(array(object({
      excerpt: optional(string()),
      score: optional(number()),
      section: optional(string()),
      book_title: optional(string()),
      chunk_id: optional(string()),
      locator_type: optional(string()),
    })), []),
  })

  /**
   * Reads one knowledge base through the demo search route.
   *
   * That route takes one question and answers a ranked list with an `excerpt`
   * field, so this maps the answer onto the record shape the browser already
   * parses. It ignores no parameter silently: `top_k` is applied here because the
   * upstream route always returns its own fixed count.
   */
  async function retrieveDemo(input: KnowledgeBaseRetrievalInput): Promise<KnowledgeBaseRetrievalResult> {
    const base = env.KNOWLEDGE_BASE_DEMO_BASE_URL?.trim().replace(/\/+$/, '')
    if (!base)
      throw createServiceUnavailableError('Knowledge base is not configured', 'KNOWLEDGE_BASE_NOT_CONFIGURED')

    const url = `${base}/knowledge-bases/${encodeURIComponent(input.knowledgeId)}/search?q=${encodeURIComponent(input.query)}`

    let response: Response
    try {
      response = await fetch(url, { signal: AbortSignal.timeout(env.KNOWLEDGE_BASE_TIMEOUT_MS) })
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

    // The route answers 404 for a knowledge base that does not exist. Report it in
    // the vocabulary the browser already explains, and do it before reading the
    // body: a 404 does not promise JSON.
    if (response.status === 404)
      return { status: 200, body: { error_code: 2001, error_msg: '知识库不存在' } }

    const raw = await response.json().catch(() => undefined)

    if (!response.ok)
      return { status: response.status, body: raw ?? { error_msg: `Knowledge base answered ${response.status}` } }

    if (raw === undefined)
      throw createBadGatewayError('Knowledge base answered with a body this API cannot read', { url, status: response.status })

    const parsed = safeParse(DemoSearchResponseSchema, raw)
    if (!parsed.success)
      throw createBadGatewayError('Knowledge base answered a shape this API does not know', { url, issues: parsed.issues })

    const records = parsed.output.results
      .slice(0, input.topK)
      .filter(result => !!result.excerpt?.trim())
      .map(result => ({
        content: result.excerpt ?? '',
        score: result.score,
        title: result.section ?? result.book_title,
        metadata: {
          section: result.section,
          book_title: result.book_title,
          chunk_id: result.chunk_id,
          locator_type: result.locator_type,
        },
      }))

    return { status: 200, body: { records } }
  }

  /**
   * Forwards one retrieval to whichever contract this deployment configured.
   *
   * The browser always sends the external knowledge base contract, so switching
   * providers is a deployment decision and never a client change.
   */
  async function retrieve(input: KnowledgeBaseRetrievalInput): Promise<KnowledgeBaseRetrievalResult> {
    if (env.KNOWLEDGE_BASE_PROVIDER === 'demo')
      return await retrieveDemo(input)

    return await retrieveDify(input)
  }

  return { retrieve }
}

export type KnowledgeBaseService = ReturnType<typeof createKnowledgeBaseService>
