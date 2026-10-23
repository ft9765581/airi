import type { Database } from '../../libs/db'
import type { MemoryCategory } from './memory-category'

import { useLogger } from '@guiiai/logg'
import { and, desc, eq, gte, inArray, isNull, lt, or, sql } from 'drizzle-orm'

import { nanoid } from '../../utils/id'
import { isMemoryCategory } from './memory-category'
import { memoryOverlap, MIN_MATCH_SCORE, scoreMemoryMatch, SUPERSEDE_SCORE } from './user-memory-match'
import { mergeProfileWithMemories } from './user-memory-profile'
import { createUserRuntimeService, normalizeClientTimestamp } from './user-runtime'
import { startOfZonedDay } from './zoned-day'

import * as schema from '../../schemas/user-memory'

export type { MemoryCategory } from './memory-category'
export { scoreMemoryMatch } from './user-memory-match'

const logger = useLogger('user-memory')

/** How many recent facts one search reads before it ranks them. */
const CANDIDATE_LIMIT = 200
/** How many facts one chat send may receive. */
const RESULT_LIMIT = 5
/** A fact loses half its weight after this many days, before recall extends it. */
const BASE_HALF_LIFE_DAYS = 14
const DAY_MS = 24 * 60 * 60 * 1000
const MAX_CONTENT_LENGTH = 500
const MIN_CONTENT_LENGTH = 4
const MAX_ITEMS = 3
/** A just-applied fact can be merged again when the profile text changed mid-save. */
const REPLAY_WINDOW_MS = 2 * 60 * 1000

export type MemoryScope = 'user' | 'character'

export interface MemoryFactInput {
  scope: MemoryScope
  content: string
  importance: number
  category?: MemoryCategory
}

export interface MemoryRecord {
  id: string
  characterId: string
  scope: MemoryScope
  category: MemoryCategory | null
  content: string
  importance: number
  recallCount: number
  lastRecalledAt: Date | null
  createdAt: Date
  updatedAt: Date
  consolidatedAt: Date | null
}

export interface MemoryRollupInput {
  timeZone: string
  profileContent: string
  profileUpdatedAt: Date
  replayIds: readonly string[]
}

export interface MemoryRollupResult {
  profileContent: string
  profileUpdatedAt: string
  rolledCount: number
  appliedIds: string[]
}

export interface RememberedMemory {
  id: string
  created: boolean
}

function isMemoryScope(value: string): value is MemoryScope {
  return value === 'user' || value === 'character'
}

function normalizeContent(value: string): string {
  return value.trim().replace(/\s+/g, ' ').slice(0, MAX_CONTENT_LENGTH)
}

function clampImportance(value: number): number {
  if (!Number.isFinite(value))
    return 5
  return Math.min(10, Math.max(1, Math.round(value)))
}

function categoryFor(scope: MemoryScope, category: MemoryCategory | undefined): MemoryCategory | null {
  if (scope !== 'user')
    return null
  if (category && isMemoryCategory(category))
    return category
  return 'other'
}

function toRecord(row: typeof schema.userMemories.$inferSelect): MemoryRecord {
  const scope: MemoryScope = row.scope === 'character' ? 'character' : 'user'
  return {
    id: row.id,
    characterId: row.characterId,
    scope,
    category: row.category != null && isMemoryCategory(row.category) ? row.category : null,
    content: row.content,
    importance: row.importance,
    recallCount: row.recallCount,
    lastRecalledAt: row.lastRecalledAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    consolidatedAt: row.consolidatedAt,
  }
}

/**
 * Weights a fact by how recently it was used and how often it was recalled.
 *
 * The clock starts at the last recall, or at creation when the fact has never
 * been recalled. Each recall lengthens the half-life, so a used fact fades
 * slower than an unused fact of the same age.
 */
function memoryWeight(row: typeof schema.userMemories.$inferSelect, now: Date): number {
  const anchor = row.lastRecalledAt ?? row.createdAt
  const ageDays = Math.max(0, (now.getTime() - anchor.getTime()) / DAY_MS)
  const halfLifeDays = BASE_HALF_LIFE_DAYS * (1 + Math.max(0, row.recallCount))
  const decay = 0.5 ** (ageDays / halfLifeDays)
  return decay * (0.5 + clampImportance(row.importance) / 10)
}

/**
 * Stores short facts for one signed-in user.
 *
 * A `user` fact follows the person onto every character card. A `character`
 * fact stays on the card that learned it. Search keeps a few facts from the
 * local calendar day that share words with the current message, then lowers
 * the weight of facts that are old and rarely recalled inside that day. A
 * later fact that shares most of its words replaces the older one. Once a day,
 * user facts from earlier days are folded into the account profile. Account
 * deletion marks the rows deleted. An empty result leaves the chat prompt
 * unchanged.
 */
export function createUserMemoryService(db: Database) {
  return {
    /**
     * Returns up to five facts for this user and character card.
     *
     * User-scoped facts apply on every card. Character-scoped facts apply only
     * on the card that stored them. Only facts from the local calendar day of
     * `now` are candidates. A fact with little overlap is left out. Each
     * returned fact counts one recall, so the next search keeps it longer.
     */
    async search(ownerId: string, characterId: string, query: string, now = new Date(), timeZone = 'UTC'): Promise<MemoryRecord[]> {
      const trimmed = query.trim()
      if (trimmed.length < 2 || !characterId)
        return []

      const dayStart = startOfZonedDay(timeZone, now)
      const rows = await db.select().from(schema.userMemories).where(and(
        eq(schema.userMemories.ownerId, ownerId),
        isNull(schema.userMemories.deletedAt),
        gte(schema.userMemories.createdAt, dayStart),
        or(
          eq(schema.userMemories.scope, 'user'),
          and(
            eq(schema.userMemories.scope, 'character'),
            eq(schema.userMemories.characterId, characterId),
          ),
        ),
      )).orderBy(desc(schema.userMemories.createdAt)).limit(CANDIDATE_LIMIT)

      const ranked = rows
        .map(row => ({
          row,
          score: scoreMemoryMatch(trimmed, row.content),
          weight: memoryWeight(row, now),
        }))
        .filter(entry => entry.score >= MIN_MATCH_SCORE)
        .sort((left, right) => {
          const leftRank = left.score * left.weight
          const rightRank = right.score * right.weight
          if (rightRank !== leftRank)
            return rightRank - leftRank
          if (right.score !== left.score)
            return right.score - left.score
          return right.row.createdAt.getTime() - left.row.createdAt.getTime()
        })

      const seen = new Set<string>()
      const selected: MemoryRecord[] = []
      for (const entry of ranked) {
        const key = entry.row.content.toLowerCase()
        if (seen.has(key))
          continue
        seen.add(key)
        selected.push(toRecord(entry.row))
        if (selected.length >= RESULT_LIMIT)
          break
      }

      if (!selected.length)
        return []

      await db.update(schema.userMemories).set({
        recallCount: sql`${schema.userMemories.recallCount} + 1`,
        lastRecalledAt: now,
      }).where(inArray(schema.userMemories.id, selected.map(record => record.id)))

      return selected.map(record => ({
        ...record,
        recallCount: record.recallCount + 1,
        lastRecalledAt: now,
      }))
    },

    /** Returns the active facts for this account, newest fact first. */
    async list(ownerId: string): Promise<MemoryRecord[]> {
      const rows = await db.select().from(schema.userMemories).where(and(
        eq(schema.userMemories.ownerId, ownerId),
        isNull(schema.userMemories.deletedAt),
      )).orderBy(desc(schema.userMemories.createdAt)).limit(CANDIDATE_LIMIT)

      return rows.map(toRecord)
    },

    /**
     * Marks one fact deleted for this account.
     *
     * A fact that belongs to another account, or is already deleted, stays
     * unchanged. The method returns false in both cases.
     */
    async remove(ownerId: string, memoryId: string, now = new Date()): Promise<boolean> {
      const [updated] = await db.update(schema.userMemories).set({
        deletedAt: now,
        updatedAt: now,
      }).where(and(
        eq(schema.userMemories.id, memoryId),
        eq(schema.userMemories.ownerId, ownerId),
        isNull(schema.userMemories.deletedAt),
      )).returning({ id: schema.userMemories.id })

      return updated != null
    },

    /**
     * Inserts up to three facts from one chat turn.
     *
     * The same text for the same owner and scope is kept once, and the later
     * importance wins. A different sentence that shares most of its words
     * replaces the older sentence. A repeated fact returns `created: false`.
     */
    async remember(
      ownerId: string,
      characterId: string,
      items: MemoryFactInput[],
      now = new Date(),
    ): Promise<RememberedMemory[]> {
      if (!characterId)
        return []

      const accepted = items.slice(0, MAX_ITEMS).flatMap((item) => {
        if (!isMemoryScope(item.scope))
          return []
        const content = normalizeContent(item.content)
        if (content.length < MIN_CONTENT_LENGTH)
          return []
        return [{
          scope: item.scope,
          content,
          importance: clampImportance(item.importance),
          category: categoryFor(item.scope, item.category),
        }]
      })
      if (!accepted.length)
        return []

      return await db.transaction(async (tx) => {
        const stored: RememberedMemory[] = []
        for (const item of accepted) {
          const duplicateFilters = [
            eq(schema.userMemories.ownerId, ownerId),
            eq(schema.userMemories.scope, item.scope),
            isNull(schema.userMemories.deletedAt),
            sql`lower(${schema.userMemories.content}) = ${item.content.toLowerCase()}`,
          ]
          if (item.scope === 'character')
            duplicateFilters.push(eq(schema.userMemories.characterId, characterId))

          const [existing] = await tx.select({ id: schema.userMemories.id })
            .from(schema.userMemories)
            .where(and(...duplicateFilters))
            .limit(1)

          if (existing) {
            await tx.update(schema.userMemories).set({
              importance: item.importance,
              category: item.category,
              updatedAt: now,
            }).where(eq(schema.userMemories.id, existing.id))
            stored.push({ id: existing.id, created: false })
            continue
          }

          const scopeFilters = [
            eq(schema.userMemories.ownerId, ownerId),
            eq(schema.userMemories.scope, item.scope),
            isNull(schema.userMemories.deletedAt),
          ]
          if (item.scope === 'character')
            scopeFilters.push(eq(schema.userMemories.characterId, characterId))

          const candidates = await tx.select().from(schema.userMemories).where(and(...scopeFilters)).orderBy(desc(schema.userMemories.updatedAt)).limit(100)

          const replacedIds = candidates
            .filter(candidate => memoryOverlap(item.content, candidate.content) >= SUPERSEDE_SCORE)
            .map(candidate => candidate.id)

          if (replacedIds.length) {
            await tx.update(schema.userMemories).set({
              deletedAt: now,
              updatedAt: now,
            }).where(inArray(schema.userMemories.id, replacedIds))
          }

          const [created] = await tx.insert(schema.userMemories).values({
            id: nanoid(),
            ownerId,
            characterId,
            scope: item.scope,
            category: item.category,
            content: item.content,
            importance: item.importance,
            recallCount: 0,
            lastRecalledAt: null,
            createdAt: now,
            updatedAt: now,
            deletedAt: null,
            consolidatedAt: null,
          }).returning()

          stored.push({ id: created!.id, created: true })
        }
        return stored
      })
    },

    /**
     * Changes one fact for this account.
     *
     * The stored time stays at creation. A missing fact returns null. Editing
     * a fact that was already written into the profile does not change the profile.
     */
    async update(
      ownerId: string,
      memoryId: string,
      input: { content: string, category?: MemoryCategory },
      now = new Date(),
    ): Promise<MemoryRecord | null> {
      const content = normalizeContent(input.content)
      if (content.length < MIN_CONTENT_LENGTH)
        return null

      const [existing] = await db.select().from(schema.userMemories).where(and(
        eq(schema.userMemories.id, memoryId),
        eq(schema.userMemories.ownerId, ownerId),
        isNull(schema.userMemories.deletedAt),
      ))
      if (!existing)
        return null

      const scope: MemoryScope = existing.scope === 'character' ? 'character' : 'user'
      const storedCategory = existing.category != null && isMemoryCategory(existing.category)
        ? existing.category
        : undefined
      const [updated] = await db.update(schema.userMemories).set({
        content,
        category: categoryFor(scope, input.category ?? storedCategory),
        updatedAt: now,
      }).where(eq(schema.userMemories.id, memoryId)).returning()

      return updated ? toRecord(updated) : null
    },

    /**
     * Folds user facts from earlier local days into the profile text.
     *
     * Facts from today stay out. Character facts stay out. The same call can
     * repeat: a fact already folded is skipped unless its id is in `replayIds`
     * and it was folded in the last two minutes. The client uses that window
     * when the profile text changed while the first call was in flight.
     */
    async rollup(ownerId: string, input: MemoryRollupInput, now = new Date()): Promise<MemoryRollupResult> {
      const runtime = createUserRuntimeService(db)
      const snapshot = await runtime.getSnapshot(ownerId)
      const settings = snapshot.settings?.deletedAt ? null : snapshot.settings
      const serverUpdated = settings?.profileUpdatedAt ?? new Date(0)
      const clientUpdated = normalizeClientTimestamp(input.profileUpdatedAt, now)
      const useClient = clientUpdated.getTime() >= serverUpdated.getTime()
      const baseContent = useClient ? input.profileContent : (settings?.profileContent ?? '')
      const baseUpdatedAt = (useClient ? clientUpdated : serverUpdated).toISOString()

      const dayStart = startOfZonedDay(input.timeZone, now)
      const pending = await db.select().from(schema.userMemories).where(and(
        eq(schema.userMemories.ownerId, ownerId),
        eq(schema.userMemories.scope, 'user'),
        isNull(schema.userMemories.deletedAt),
        isNull(schema.userMemories.consolidatedAt),
        lt(schema.userMemories.createdAt, dayStart),
      ))

      const replayCutoff = new Date(now.getTime() - REPLAY_WINDOW_MS)
      const replay = input.replayIds.length
        ? await db.select().from(schema.userMemories).where(and(
            eq(schema.userMemories.ownerId, ownerId),
            eq(schema.userMemories.scope, 'user'),
            isNull(schema.userMemories.deletedAt),
            inArray(schema.userMemories.id, [...input.replayIds]),
            gte(schema.userMemories.consolidatedAt, replayCutoff),
          ))
        : []

      const byId = new Map<string, typeof schema.userMemories.$inferSelect>()
      for (const row of [...pending, ...replay])
        byId.set(row.id, row)

      const facts = [...byId.values()].map(row => ({
        id: row.id,
        category: row.category != null && isMemoryCategory(row.category) ? row.category : 'other' as const,
        content: row.content,
        createdAt: row.createdAt.getTime(),
      }))
      if (!facts.length) {
        return {
          profileContent: baseContent,
          profileUpdatedAt: baseUpdatedAt,
          rolledCount: 0,
          appliedIds: [],
        }
      }

      const merged = mergeProfileWithMemories(baseContent, facts)
      if (!merged.appliedIds.length) {
        return {
          profileContent: baseContent,
          profileUpdatedAt: baseUpdatedAt,
          rolledCount: 0,
          appliedIds: [],
        }
      }

      const saved = await runtime.saveSettings(ownerId, {
        activeCardId: settings?.activeCardId ?? '',
        activeCardUpdatedAt: settings?.activeCardUpdatedAt ?? now,
        profileContent: merged.content,
        profileUpdatedAt: now,
      }, now)
      await db.update(schema.userMemories).set({
        consolidatedAt: now,
      }).where(and(
        eq(schema.userMemories.ownerId, ownerId),
        inArray(schema.userMemories.id, merged.appliedIds),
      ))

      return {
        profileContent: saved.profileContent,
        profileUpdatedAt: saved.profileUpdatedAt.toISOString(),
        rolledCount: merged.appliedIds.length,
        appliedIds: merged.appliedIds,
      }
    },

    async deleteAllForUser(userId: string) {
      const now = new Date()
      await db.update(schema.userMemories).set({
        deletedAt: now,
      }).where(eq(schema.userMemories.ownerId, userId))

      logger.withFields({ userId }).log('Long-term memory soft-deleted for user')
    },
  }
}

export type UserMemoryService = ReturnType<typeof createUserMemoryService>
