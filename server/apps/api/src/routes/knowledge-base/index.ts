import type { ContentfulStatusCode } from 'hono/utils/http-status'

import type { KnowledgeBaseService } from '../../services/domain/knowledge-base'
import type { HonoEnv } from '../../types/hono'

import { Hono } from 'hono'
import { safeParse } from 'valibot'

import { authGuard } from '../../middlewares/auth'
import { createBadRequestError } from '../../utils/error'
import { KnowledgeBaseRetrievalRequestSchema } from './schema'

/**
 * Knowledge base retrieval proxy.
 *
 * Mounted at `/api/v1/knowledge-base`. The browser posts the Dify external
 * knowledge base contract it already speaks, and this route forwards it with the
 * deployment's key. Sign-in is required: without it the endpoint would be an open
 * relay to the deployment's knowledge base for anyone who reads the bundle.
 */
export function createKnowledgeBaseRoutes(service: KnowledgeBaseService) {
  return new Hono<HonoEnv>()
    .use('*', authGuard)

    .post('/retrieval', async (c) => {
      const payload = await c.req.json().catch(() => null)
      const result = safeParse(KnowledgeBaseRetrievalRequestSchema, payload)

      if (!result.success) {
        throw createBadRequestError('Invalid Request', 'INVALID_REQUEST', result.issues)
      }

      const setting = result.output.retrieval_setting
      const upstream = await service.retrieve({
        knowledgeId: result.output.knowledge_id,
        query: result.output.query,
        topK: setting?.top_k ?? 5,
        scoreThreshold: setting?.score_threshold ?? 0,
      })

      return c.json(upstream.body, upstream.status as ContentfulStatusCode)
    })
}
