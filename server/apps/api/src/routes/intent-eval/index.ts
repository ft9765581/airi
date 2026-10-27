import type { IntentEvalService } from '../../services/domain/intent-eval'
import type { HonoEnv } from '../../types/hono'

import { Hono } from 'hono'
import { safeParse } from 'valibot'

import { authGuard } from '../../middlewares/auth'
import { CollectionMissingError } from '../../services/domain/intent-eval'
import { createBadRequestError, createNotFoundError } from '../../utils/error'
import {
  CreateIntentCollectionSchema,
  CreateIntentRunSchema,
  CreateIntentSampleSchema,
  ImportIntentSamplesSchema,
  UpdateIntentCollectionSchema,
  UpdateIntentRunSchema,
  UpdateIntentSampleSchema,
} from './schema'

/**
 * Labelled intent samples and batch evaluation runs.
 *
 * Mounted at `/api/v1/intent-eval`. The devtools page uses it to keep one sample
 * set and its run history per person; the browser stores no authority of its own
 * for either (intent-routing.md §9.4).
 *
 * Every repository call passes the signed-in user id, so a resource belonging to
 * someone else is reported as missing.
 */
/** Maps a rejected collection id to a 400 the page can show. */
async function withCollectionCheck<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  }
  catch (error) {
    if (error instanceof CollectionMissingError)
      throw createBadRequestError('Unknown collection', 'INVALID_REQUEST')

    throw error
  }
}
export function createIntentEvalRoutes(service: IntentEvalService) {
  const userOf = (c: { get: (key: 'user') => { id: string } | undefined }) => c.get('user')!

  return new Hono<HonoEnv>()
    .use('*', authGuard)

    .get('/collections', async (c) => {
      const rows = await service.listCollections(userOf(c).id)
      return c.json(rows)
    })

    .post('/collections', async (c) => {
      const payload = await c.req.json().catch(() => null)
      const result = safeParse(CreateIntentCollectionSchema, payload)

      if (!result.success)
        throw createBadRequestError('Invalid Request', 'INVALID_REQUEST', result.issues)

      const row = await service.createCollection(userOf(c).id, result.output)
      return c.json(row, 201)
    })

    .patch('/collections/:id', async (c) => {
      const payload = await c.req.json().catch(() => null)
      const result = safeParse(UpdateIntentCollectionSchema, payload)

      if (!result.success)
        throw createBadRequestError('Invalid Request', 'INVALID_REQUEST', result.issues)

      const row = await service.updateCollection(userOf(c).id, c.req.param('id'), result.output)
      if (!row)
        throw createNotFoundError()

      return c.json(row)
    })

    .delete('/collections/:id', async (c) => {
      const row = await service.deleteCollection(userOf(c).id, c.req.param('id'))
      if (!row)
        throw createNotFoundError()

      return c.body(null, 204)
    })

    .get('/samples', async (c) => {
      const collectionId = c.req.query('collectionId')
      const rows = await service.listSamples(userOf(c).id, collectionId)
      return c.json(rows)
    })

    .post('/samples', async (c) => {
      const payload = await c.req.json().catch(() => null)
      const result = safeParse(CreateIntentSampleSchema, payload)

      if (!result.success)
        throw createBadRequestError('Invalid Request', 'INVALID_REQUEST', result.issues)

      const row = await withCollectionCheck(() => service.createSample(userOf(c).id, result.output))
      return c.json(row, 201)
    })

    .post('/samples/import', async (c) => {
      const payload = await c.req.json().catch(() => null)
      const result = safeParse(ImportIntentSamplesSchema, payload)

      if (!result.success)
        throw createBadRequestError('Invalid Request', 'INVALID_REQUEST', result.issues)

      // One statement: a rejected row rejects the file, so an import cannot land
      // half of a set and read as a complete one.
      const rows = await withCollectionCheck(() => service.createSamples(userOf(c).id, result.output.samples))
      return c.json(rows, 201)
    })

    .patch('/samples/:id', async (c) => {
      const payload = await c.req.json().catch(() => null)
      const result = safeParse(UpdateIntentSampleSchema, payload)

      if (!result.success)
        throw createBadRequestError('Invalid Request', 'INVALID_REQUEST', result.issues)

      const row = await withCollectionCheck(() => service.updateSample(userOf(c).id, c.req.param('id'), result.output))
      if (!row)
        throw createNotFoundError()

      return c.json(row)
    })

    .delete('/samples/:id', async (c) => {
      const row = await service.deleteSample(userOf(c).id, c.req.param('id'))
      if (!row)
        throw createNotFoundError()

      return c.body(null, 204)
    })

    .get('/runs', async (c) => {
      const requested = Number(c.req.query('limit') ?? '20')
      const limit = Number.isFinite(requested) ? Math.min(Math.max(Math.trunc(requested), 1), 100) : 20

      const rows = await service.listRuns(userOf(c).id, limit)
      return c.json(rows)
    })

    .get('/runs/:id', async (c) => {
      const row = await service.getRun(userOf(c).id, c.req.param('id'))
      if (!row)
        throw createNotFoundError()

      return c.json(row)
    })

    .post('/runs', async (c) => {
      const payload = await c.req.json().catch(() => null)
      const result = safeParse(CreateIntentRunSchema, payload)

      if (!result.success)
        throw createBadRequestError('Invalid Request', 'INVALID_REQUEST', result.issues)

      const row = await service.createRun(userOf(c).id, result.output)
      return c.json(row, 201)
    })

    .patch('/runs/:id', async (c) => {
      const payload = await c.req.json().catch(() => null)
      const result = safeParse(UpdateIntentRunSchema, payload)

      if (!result.success)
        throw createBadRequestError('Invalid Request', 'INVALID_REQUEST', result.issues)

      const row = await service.updateRun(userOf(c).id, c.req.param('id'), result.output)
      if (!row)
        throw createNotFoundError()

      return c.json(row)
    })
}
