import type { UserRuntimeService } from '../../services/domain/user-runtime'
import type { HonoEnv } from '../../types/hono'

import { Hono } from 'hono'
import { safeParse } from 'valibot'

import { authGuard } from '../../middlewares/auth'
import { createBadRequestError } from '../../utils/error'
import { DeleteRuntimeCardSchema, RuntimeCardIdSchema, SaveRuntimeCardSchema, SaveRuntimeSettingsSchema } from './schema'

const MAX_CARD_JSON_LENGTH = 500_000

function parseCardId(cardId: string) {
  const parsed = safeParse(RuntimeCardIdSchema, cardId)
  if (!parsed.success)
    throw createBadRequestError('Invalid card id', 'INVALID_REQUEST', parsed.issues)
  return parsed.output
}

function assertCardObject(card: unknown) {
  if (card == null || typeof card !== 'object' || Array.isArray(card))
    throw createBadRequestError('Card must be a JSON object', 'INVALID_REQUEST')

  const encoded = JSON.stringify(card)
  if (encoded.length > MAX_CARD_JSON_LENGTH)
    throw createBadRequestError('Card is too large', 'INVALID_REQUEST')

  return card
}

export function createUserRuntimeRoutes(userRuntimeService: UserRuntimeService) {
  return new Hono<HonoEnv>()
    .use('*', authGuard)

    .get('/', async (c) => {
      const user = c.get('user')!
      const snapshot = await userRuntimeService.getSnapshot(user.id)
      return c.json(snapshot)
    })

    .put('/settings', async (c) => {
      const user = c.get('user')!
      const body = await c.req.json()
      const result = safeParse(SaveRuntimeSettingsSchema, body)
      if (!result.success)
        throw createBadRequestError('Invalid Request', 'INVALID_REQUEST', result.issues)

      const settings = await userRuntimeService.saveSettings(user.id, {
        activeCardId: result.output.activeCardId,
        activeCardUpdatedAt: new Date(result.output.activeCardUpdatedAt),
        profileContent: result.output.profileContent,
        profileUpdatedAt: new Date(result.output.profileUpdatedAt),
        sections: result.output.sections,
      })

      return c.json(settings)
    })

    .put('/cards/:cardId', async (c) => {
      const user = c.get('user')!
      const cardId = parseCardId(c.req.param('cardId'))
      const body = await c.req.json()
      const result = safeParse(SaveRuntimeCardSchema, body)
      if (!result.success)
        throw createBadRequestError('Invalid Request', 'INVALID_REQUEST', result.issues)

      const saved = await userRuntimeService.saveCard(
        user.id,
        cardId,
        assertCardObject(result.output.card),
        new Date(result.output.updatedAt),
      )

      return c.json(saved)
    })

    .delete('/cards/:cardId', async (c) => {
      const user = c.get('user')!
      const cardId = parseCardId(c.req.param('cardId'))
      const body = await c.req.json()
      const result = safeParse(DeleteRuntimeCardSchema, body)
      if (!result.success)
        throw createBadRequestError('Invalid Request', 'INVALID_REQUEST', result.issues)

      const deleted = await userRuntimeService.deleteCard(user.id, cardId, new Date(result.output.updatedAt))
      if (!deleted)
        return c.body(null, 204)

      return c.json(deleted)
    })
}
