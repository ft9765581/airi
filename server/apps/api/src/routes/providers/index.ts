import type { ProviderService } from '../../services/domain/providers'
import type { HonoEnv } from '../../types/hono'

import { Hono } from 'hono'
import { safeParse } from 'valibot'

import { authGuard } from '../../middlewares/auth'
import { createBadRequestError, createNotFoundError } from '../../utils/error'
import { CreateProviderConfigSchema, UpdateProviderConfigSchema } from './schema'

export function createProviderRoutes(providerService: ProviderService) {
  return new Hono<HonoEnv>()
    .use('*', authGuard)

    .get('/', async (c) => {
      const user = c.get('user')!
      const providers = await providerService.findAll(user.id)
      return c.json(providers)
    })

    .get('/:id', async (c) => {
      const user = c.get('user')!
      const id = c.req.param('id')
      const provider = await providerService.findById(id, user.id)
      if (!provider)
        throw createNotFoundError()

      return c.json(provider)
    })

    .post('/', async (c) => {
      const user = c.get('user')!
      const body = await c.req.json()
      const result = safeParse(CreateProviderConfigSchema, body)

      if (!result.success) {
        throw createBadRequestError('Invalid Request', 'INVALID_REQUEST', result.issues)
      }

      const provider = await providerService.createUserConfig({
        ...result.output,
        ownerId: user.id,
      })

      return c.json(provider, 201)
    })

    .patch('/:id', async (c) => {
      const user = c.get('user')!
      const id = c.req.param('id')
      const body = await c.req.json()
      const result = safeParse(UpdateProviderConfigSchema, body)

      if (!result.success) {
        throw createBadRequestError('Invalid Request', 'INVALID_REQUEST', result.issues)
      }

      // The id is unique per owner only, so the update is owner-scoped. Another
      // account's row with the same id resolves to 404 rather than 403: the
      // response must not reveal that the id exists elsewhere.
      const updated = await providerService.updateUserConfig(id, user.id, result.output)
      if (!updated)
        throw createNotFoundError()

      return c.json(updated)
    })

    .delete('/:id', async (c) => {
      const user = c.get('user')!
      const id = c.req.param('id')

      const deleted = await providerService.deleteUserConfig(id, user.id)
      if (deleted.length === 0)
        throw createNotFoundError()

      return c.body(null, 204)
    })
}
