import type { UserMemoryService } from '../../services/domain/user-memory'
import type { HonoEnv } from '../../types/hono'

import { Hono } from 'hono'
import { safeParse } from 'valibot'

import { authGuard } from '../../middlewares/auth'
import { createBadRequestError, createNotFoundError } from '../../utils/error'
import { MemoryIdSchema, RememberMemoriesSchema, SearchMemoriesQuerySchema } from './schema'

export function createUserMemoryRoutes(userMemoryService: UserMemoryService) {
  return new Hono<HonoEnv>()
    .use('*', authGuard)

    .get('/', async (c) => {
      const user = c.get('user')!
      const parsed = safeParse(SearchMemoriesQuerySchema, {
        characterId: c.req.query('characterId') ?? '',
        query: c.req.query('query') ?? '',
      })
      if (!parsed.success)
        throw createBadRequestError('Invalid Request', 'INVALID_REQUEST', parsed.issues)

      const memories = await userMemoryService.search(
        user.id,
        parsed.output.characterId,
        parsed.output.query,
      )
      return c.json({ memories })
    })

    .get('/items', async (c) => {
      const user = c.get('user')!
      const memories = await userMemoryService.list(user.id)
      return c.json({ memories })
    })

    .delete('/:memoryId', async (c) => {
      const user = c.get('user')!
      const parsed = safeParse(MemoryIdSchema, c.req.param('memoryId'))
      if (!parsed.success)
        throw createBadRequestError('Invalid Request', 'INVALID_REQUEST', parsed.issues)

      const removed = await userMemoryService.remove(user.id, parsed.output)
      if (!removed)
        throw createNotFoundError('Memory not found')

      return c.body(null, 204)
    })

    .post('/', async (c) => {
      const user = c.get('user')!
      const body = await c.req.json()
      const parsed = safeParse(RememberMemoriesSchema, body)
      if (!parsed.success)
        throw createBadRequestError('Invalid Request', 'INVALID_REQUEST', parsed.issues)

      const memories = await userMemoryService.remember(
        user.id,
        parsed.output.characterId,
        parsed.output.items,
      )
      return c.json({ memories })
    })
}
