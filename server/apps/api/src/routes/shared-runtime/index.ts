import type { Database } from '../../libs/db'
import type { HonoEnv } from '../../types/hono'

import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { safeParse } from 'valibot'

import { configKV } from '../../schemas/config-kv'
import { createBadRequestError, createForbiddenError, createServiceUnavailableError } from '../../utils/error'
import { SharedRuntimeSettingsSchema } from './schema'

const CONFIG_KEY = 'SHARED_RUNTIME_CONFIG'

/**
 * The suffix this deployment writes into `user.email` for phone sign-ups.
 *
 * A phone account keeps its number here and never goes through mail
 * verification, because this deployment has no mail service. Requiring
 * `emailVerified` would therefore lock the deployment owner out of publishing.
 * The suffix cannot be claimed by anyone else, so allowing it stays safe: an
 * ordinary mailbox still needs the verification flag.
 */
const PHONE_ACCOUNT_DOMAIN = 'phone.local'

/** Serves one deployment configuration to every visitor. Only the named account can publish it. */
export function createSharedRuntimeRoutes(db: Database, adminEmail: string) {
  const canEdit = (user: { email: string, emailVerified: boolean } | null) => {
    if (!user)
      return false

    const email = user.email.toLowerCase()
    if (email !== adminEmail.toLowerCase())
      return false

    return user.emailVerified || email.endsWith(`@${PHONE_ACCOUNT_DOMAIN}`)
  }

  return new Hono<HonoEnv>()
    .get('/', async (c) => {
      const row = await db.query.configKV.findFirst({ where: eq(configKV.key, CONFIG_KEY) })
      if (!row)
        return c.json({ settings: null, updatedAt: null, canEdit: canEdit(c.get('user')) })

      let stored: unknown
      try {
        stored = JSON.parse(row.value)
      }
      catch {
        throw createServiceUnavailableError('Shared runtime settings are invalid', 'CONFIG_INVALID')
      }
      const parsed = safeParse(SharedRuntimeSettingsSchema, stored)
      if (!parsed.success)
        throw createServiceUnavailableError('Shared runtime settings are invalid', 'CONFIG_INVALID')

      return c.json({ settings: parsed.output, updatedAt: row.updatedAt.toISOString(), canEdit: canEdit(c.get('user')) })
    })
    .put('/', async (c) => {
      if (!canEdit(c.get('user')))
        throw createForbiddenError()

      const body = await c.req.json()
      const parsed = safeParse(SharedRuntimeSettingsSchema, body)
      if (!parsed.success)
        throw createBadRequestError('Invalid shared runtime settings', 'INVALID_REQUEST', parsed.issues)

      const encoded = JSON.stringify(parsed.output)
      if (encoded.length > 500_000)
        throw createBadRequestError('Shared runtime settings are too large')

      const [row] = await db.insert(configKV).values({ key: CONFIG_KEY, value: encoded }).onConflictDoUpdate({ target: configKV.key, set: { value: encoded, updatedAt: new Date() } }).returning({ updatedAt: configKV.updatedAt })
      return c.json({ settings: parsed.output, updatedAt: row.updatedAt.toISOString(), canEdit: true })
    })
}
