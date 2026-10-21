import type { Database } from '../../libs/db'

import { useLogger } from '@guiiai/logg'
import { and, eq } from 'drizzle-orm'

import * as schema from '../../schemas/user-runtime'

const logger = useLogger('user-runtime')

/** A client clock more than one hour ahead is stored as the server time. */
const FUTURE_SKEW_MS = 60 * 60 * 1000

export interface RuntimeCardRecord {
  cardId: string
  card: unknown
  updatedAt: Date
  deletedAt: Date | null
}

export interface RuntimeSettingsRecord {
  activeCardId: string
  activeCardUpdatedAt: Date
  profileContent: string
  profileUpdatedAt: Date
  deletedAt: Date | null
}

export interface RuntimeProfileSnapshot {
  settings: RuntimeSettingsRecord | null
  cards: RuntimeCardRecord[]
}

export interface SaveRuntimeSettingsInput {
  activeCardId: string
  activeCardUpdatedAt: Date
  profileContent: string
  profileUpdatedAt: Date
}

export interface SaveRuntimeCardResult {
  applied: boolean
  record: RuntimeCardRecord
}

/**
 * Normalizes a client save time.
 *
 * A timestamp far in the future would win every later save. The server stores
 * its own clock when the client clock is more than one hour ahead.
 */
export function normalizeClientTimestamp(incoming: Date, now: Date): Date {
  if (incoming.getTime() > now.getTime() + FUTURE_SKEW_MS)
    return now
  return incoming
}

function isCurrentOrNewer(incoming: Date, stored: Date): boolean {
  return incoming.getTime() >= stored.getTime()
}

function toCardRecord(row: typeof schema.userRuntimeCards.$inferSelect): RuntimeCardRecord {
  return {
    cardId: row.cardId,
    card: row.card,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  }
}

function toSettingsRecord(row: typeof schema.userRuntimeSettings.$inferSelect): RuntimeSettingsRecord {
  return {
    activeCardId: row.activeCardId,
    activeCardUpdatedAt: row.activeCardUpdatedAt,
    profileContent: row.profileContent,
    profileUpdatedAt: row.profileUpdatedAt,
    deletedAt: row.deletedAt,
  }
}

/**
 * Stores the signed-in user's runtime character cards, active card, and profile text.
 *
 * Each field keeps the save with the newer timestamp. An older save leaves the
 * stored row in place so two devices converge on the later edit.
 */
export function createUserRuntimeService(db: Database) {
  return {
    async getSnapshot(ownerId: string): Promise<RuntimeProfileSnapshot> {
      const [settings] = await db.select().from(schema.userRuntimeSettings).where(eq(schema.userRuntimeSettings.ownerId, ownerId))
      const cards = await db.select().from(schema.userRuntimeCards).where(eq(schema.userRuntimeCards.ownerId, ownerId))

      return {
        settings: settings ? toSettingsRecord(settings) : null,
        cards: cards.map(toCardRecord),
      }
    },

    async saveSettings(ownerId: string, input: SaveRuntimeSettingsInput, now = new Date()): Promise<RuntimeSettingsRecord> {
      const activeCardUpdatedAt = normalizeClientTimestamp(input.activeCardUpdatedAt, now)
      const profileUpdatedAt = normalizeClientTimestamp(input.profileUpdatedAt, now)

      return await db.transaction(async (tx) => {
        const [existing] = await tx.select().from(schema.userRuntimeSettings).where(eq(schema.userRuntimeSettings.ownerId, ownerId))

        if (!existing) {
          const [created] = await tx.insert(schema.userRuntimeSettings).values({
            ownerId,
            activeCardId: input.activeCardId,
            activeCardUpdatedAt,
            profileContent: input.profileContent,
            profileUpdatedAt,
            deletedAt: null,
          }).returning()
          return toSettingsRecord(created!)
        }

        const nextActive = isCurrentOrNewer(activeCardUpdatedAt, existing.activeCardUpdatedAt)
          ? { activeCardId: input.activeCardId, activeCardUpdatedAt }
          : { activeCardId: existing.activeCardId, activeCardUpdatedAt: existing.activeCardUpdatedAt }
        const nextProfile = isCurrentOrNewer(profileUpdatedAt, existing.profileUpdatedAt)
          ? { profileContent: input.profileContent, profileUpdatedAt }
          : { profileContent: existing.profileContent, profileUpdatedAt: existing.profileUpdatedAt }
        const revive = existing.deletedAt != null && (nextActive.activeCardUpdatedAt.getTime() > existing.deletedAt.getTime() || nextProfile.profileUpdatedAt.getTime() > existing.deletedAt.getTime())

        const [updated] = await tx.update(schema.userRuntimeSettings).set({
          ...nextActive,
          ...nextProfile,
          deletedAt: revive ? null : existing.deletedAt,
        }).where(eq(schema.userRuntimeSettings.ownerId, ownerId)).returning()

        return toSettingsRecord(updated!)
      })
    },

    async saveCard(ownerId: string, cardId: string, card: unknown, updatedAt: Date, now = new Date()): Promise<SaveRuntimeCardResult> {
      const stampedAt = normalizeClientTimestamp(updatedAt, now)

      return await db.transaction(async (tx) => {
        const [existing] = await tx.select().from(schema.userRuntimeCards).where(and(
          eq(schema.userRuntimeCards.ownerId, ownerId),
          eq(schema.userRuntimeCards.cardId, cardId),
        ))

        if (existing && !isCurrentOrNewer(stampedAt, existing.updatedAt))
          return { applied: false, record: toCardRecord(existing) }

        if (!existing) {
          const [created] = await tx.insert(schema.userRuntimeCards).values({
            ownerId,
            cardId,
            card,
            updatedAt: stampedAt,
            deletedAt: null,
          }).returning()
          return { applied: true, record: toCardRecord(created!) }
        }

        const [updated] = await tx.update(schema.userRuntimeCards).set({
          card,
          updatedAt: stampedAt,
          deletedAt: null,
        }).where(and(
          eq(schema.userRuntimeCards.ownerId, ownerId),
          eq(schema.userRuntimeCards.cardId, cardId),
        )).returning()

        return { applied: true, record: toCardRecord(updated!) }
      })
    },

    async deleteCard(ownerId: string, cardId: string, updatedAt: Date, now = new Date()): Promise<SaveRuntimeCardResult | null> {
      const stampedAt = normalizeClientTimestamp(updatedAt, now)

      return await db.transaction(async (tx) => {
        const [existing] = await tx.select().from(schema.userRuntimeCards).where(and(
          eq(schema.userRuntimeCards.ownerId, ownerId),
          eq(schema.userRuntimeCards.cardId, cardId),
        ))

        if (!existing)
          return null

        if (!isCurrentOrNewer(stampedAt, existing.updatedAt))
          return { applied: false, record: toCardRecord(existing) }

        const [updated] = await tx.update(schema.userRuntimeCards).set({
          updatedAt: stampedAt,
          deletedAt: stampedAt,
        }).where(and(
          eq(schema.userRuntimeCards.ownerId, ownerId),
          eq(schema.userRuntimeCards.cardId, cardId),
        )).returning()

        return { applied: true, record: toCardRecord(updated!) }
      })
    },

    async deleteAllForUser(userId: string) {
      const now = new Date()

      await db.update(schema.userRuntimeCards).set({
        deletedAt: now,
        updatedAt: now,
      }).where(eq(schema.userRuntimeCards.ownerId, userId))

      await db.update(schema.userRuntimeSettings).set({
        deletedAt: now,
      }).where(eq(schema.userRuntimeSettings.ownerId, userId))

      logger.withFields({ userId }).log('Runtime profile soft-deleted for user')
    },
  }
}

export type UserRuntimeService = ReturnType<typeof createUserRuntimeService>
