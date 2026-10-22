import type { UserMemoryService } from '../../services/domain/user-memory'
import type { HonoEnv } from '../../types/hono'

import { Hono } from 'hono'
import { safeParse } from 'valibot'

import { authGuard } from '../../middlewares/auth'
import { createBadRequestError, createNotFoundError } from '../../utils/error'
import { MemoryIdSchema, RememberMemoriesSchema, RollupMemoriesSchema, SearchMemoriesQuerySchema, UpdateMemorySchema } from './schema'

export function createUserMemoryRoutes(userMemoryService: UserMemoryService) {
  return new Hono<HonoEnv>()
    .use('*', authGuard)

    .get('/', async (c) => {
      const user = c.get('user')!
      const parsed = safeParse(SearchMemoriesQuerySchema, {
        characterId: c.req.query('characterId') ?? '',
        query: c.req.query('query') ?? '',
        timeZone: c.req.query('timeZone'),
      })
      if (!parsed.success)
        throw createBadRequestError('Invalid Request', 'INVALID_REQUEST', parsed.issues)

      const memories = await userMemoryService.search(
        user.id,
        parsed.output.characterId,
        parsed.output.query,
        new Date(),
        parsed.output.timeZone ?? 'UTC',
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

    .patch('/:memoryId', async (c) => {
      const user = c.get('user')!
      const parsedId = safeParse(MemoryIdSchema, c.req.param('memoryId'))
      if (!parsedId.success)
        throw createBadRequestError('Invalid Request', 'INVALID_REQUEST', parsedId.issues)

      const body = await c.req.json()
      const parsed = safeParse(UpdateMemorySchema, body)
      if (!parsed.success)
        throw createBadRequestError('Invalid Request', 'INVALID_REQUEST', parsed.issues)

      const memory = await userMemoryService.update(user.id, parsedId.output, parsed.output)
      if (!memory)
        throw createNotFoundError('Memory not found')

      return c.json({ memory })
    })

    .post('/rollup', async (c) => {
      const user = c.get('user')!
      const body = await c.req.json()
      const parsed = safeParse(RollupMemoriesSchema, body)
      if (!parsed.success)
        throw createBadRequestError('Invalid Request', 'INVALID_REQUEST', parsed.issues)

      const profileUpdatedAt = new Date(parsed.output.profileUpdatedAt)
      if (Number.isNaN(profileUpdatedAt.getTime()))
        throw createBadRequestError('Invalid Request', 'INVALID_REQUEST')

      const result = await userMemoryService.rollup(user.id, {
        timeZone: parsed.output.timeZone,
        profileContent: parsed.output.profileContent,
        profileUpdatedAt,
        replayIds: parsed.output.replayIds ?? [],
      })
      return c.json(result)
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
