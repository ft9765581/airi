import type { ContentfulStatusCode } from 'hono/utils/http-status'

import type { KnowledgeGraphService } from '../../services/domain/knowledge-graph'
import type { HonoEnv } from '../../types/hono'

import { Hono } from 'hono'
import { safeParse } from 'valibot'

import { createBadRequestError } from '../../utils/error'
import { KnowledgeGraphSearchQuerySchema } from './schema'

/**
 * Knowledge graph search proxy.
 *
 * Mounted at `/api/v1/knowledge-graph`. The browser sends the published search
 * parameters and this route forwards them.
 *
 * Why this route has no `authGuard` while the retrieval proxy next to it has one:
 * - The graph service needs no key (`RAG_API_TOKEN` is empty there), so this
 *   route protects no secret. The retrieval proxy does hold a key.
 * - A signed-in-only route would make the graph unusable for every visitor who
 *   has no account, and this deployment ships the graph to visitors who only
 *   chat.
 *
 * The tradeoff is one open relay to a public search endpoint. If the graph
 * service starts to require a key, add `authGuard` back here and keep the key in
 * `KNOWLEDGE_GRAPH_API_KEY`.
 */
export function createKnowledgeGraphRoutes(service: KnowledgeGraphService) {
  return new Hono<HonoEnv>()
    .get('/search', async (c) => {
      const result = safeParse(KnowledgeGraphSearchQuerySchema, c.req.query())

      if (!result.success) {
        throw createBadRequestError('Invalid Request', 'INVALID_REQUEST', result.issues)
      }

      const upstream = await service.search({
        query: result.output.q,
        limit: result.output.limit,
        bookId: result.output.book_id,
      })

      return c.json(upstream.body, upstream.status as ContentfulStatusCode)
    })
}
