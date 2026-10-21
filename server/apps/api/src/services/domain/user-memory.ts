import type { Database } from '../../libs/db'

import { useLogger } from '@guiiai/logg'
import { and, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm'

import { nanoid } from '../../utils/id'

import * as schema from '../../schemas/user-memory'

const logger = useLogger('user-memory')

/** How many recent facts one search reads before it ranks them. */
const CANDIDATE_LIMIT = 200
/** How many facts one chat send may receive. */
const RESULT_LIMIT = 5
/**
 * The minimum share of query tokens that must appear in a fact.
 *
 * One match out of three tokens is enough. A lower share lets common words
 * pull in unrelated facts. The chat then receives no memory for that message.
 */
const MIN_MATCH_SCORE = 1 / 3
/**
 * Overlap at which a new fact replaces an older fact with the same meaning.
 *
 * The same text is kept as one row. A later sentence that shares most of its
 * words replaces the older sentence, so two devices converge on the later write.
 */
const SUPERSEDE_SCORE = 0.6
/** A fact loses half its weight after this many days, before recall extends it. */
const BASE_HALF_LIFE_DAYS = 14
const DAY_MS = 24 * 60 * 60 * 1000
const MAX_CONTENT_LENGTH = 500
const MIN_CONTENT_LENGTH = 4
const MAX_ITEMS = 3

const LATIN_STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'be',
  'did',
  'do',
  'does',
  'for',
  'how',
  'in',
  'is',
  'it',
  'me',
  'my',
  'of',
  'on',
  'or',
  'our',
  'that',
  'the',
  'this',
  'to',
  'was',
  'we',
  'were',
  'what',
  'when',
  'where',
  'why',
  'with',
  'you',
  'your',
])

export type MemoryScope = 'user' | 'character'

export interface MemoryFactInput {
  scope: MemoryScope
  content: string
  importance: number
}

export interface MemoryRecord {
  id: string
  characterId: string
  scope: MemoryScope
  content: string
  importance: number
  recallCount: number
  lastRecalledAt: Date | null
  createdAt: Date
  updatedAt: Date
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

function latinWords(value: string): string[] {
  return value.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []
}

/** Two-character pieces of the CJK text. Latin text is matched by words instead. */
function cjkBigrams(value: string): string[] {
  const compact = value.replace(/[^\u3400-\u9FFF]/g, '')
  const grams: string[] = []
  for (let index = 0; index < compact.length - 1; index += 1)
    grams.push(compact.slice(index, index + 2))
  return grams
}

/**
 * Scores how much of the current message appears in one fact.
 *
 * A shared substring of the whole message scores 1. Otherwise the score is the
 * share of meaningful words and CJK pairs that the fact contains. This stays
 * inside Postgres text search and does not call an embedding model.
 */
function scoreMemoryMatch(query: string, content: string): number {
  const normalizedQuery = query.trim().toLowerCase().replace(/\s+/g, ' ')
  const normalizedContent = content.trim().toLowerCase().replace(/\s+/g, ' ')
  if (normalizedQuery.length < 2 || !normalizedContent)
    return 0

  if (normalizedContent.includes(normalizedQuery) || normalizedQuery.includes(normalizedContent))
    return 1

  const words = latinWords(normalizedQuery).filter(word => !LATIN_STOPWORDS.has(word))
  const grams = cjkBigrams(normalizedQuery)
  const tokenCount = words.length + grams.length
  if (tokenCount === 0)
    return 0

  let hits = 0
  for (const word of words) {
    if (normalizedContent.includes(word))
      hits += 1
  }
  for (const gram of grams) {
    if (normalizedContent.includes(gram))
      hits += 1
  }
  return hits / tokenCount
}

function toRecord(row: typeof schema.userMemories.$inferSelect): MemoryRecord {
  const scope: MemoryScope = row.scope === 'character' ? 'character' : 'user'
  return {
    id: row.id,
    characterId: row.characterId,
    scope,
    content: row.content,
    importance: row.importance,
    recallCount: row.recallCount,
    lastRecalledAt: row.lastRecalledAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
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
 * fact stays on the card that learned it. Search keeps a few facts that share
 * words with the current message, then lowers the weight of facts that are old
 * and rarely recalled. A later fact that shares most of its words replaces the
 * older one. Account deletion marks the rows deleted. An empty result leaves
 * the chat prompt unchanged.
 */
export function createUserMemoryService(db: Database) {
  return {
    /**
     * Returns up to five facts for this user and character card.
     *
     * User-scoped facts apply on every card. Character-scoped facts apply only
     * on the card that stored them. A fact with little overlap is left out.
     * Each returned fact counts one recall, so the next search keeps it longer.
     */
    async search(ownerId: string, characterId: string, query: string, now = new Date()): Promise<MemoryRecord[]> {
      const trimmed = query.trim()
      if (trimmed.length < 2 || !characterId)
        return []

      const rows = await db.select().from(schema.userMemories).where(and(
        eq(schema.userMemories.ownerId, ownerId),
        isNull(schema.userMemories.deletedAt),
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

    /** Returns the active facts for this account, newest edit first. */
    async list(ownerId: string): Promise<MemoryRecord[]> {
      const rows = await db.select().from(schema.userMemories).where(and(
        eq(schema.userMemories.ownerId, ownerId),
        isNull(schema.userMemories.deletedAt),
      )).orderBy(desc(schema.userMemories.updatedAt)).limit(CANDIDATE_LIMIT)

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
            .filter(candidate => Math.max(
              scoreMemoryMatch(item.content, candidate.content),
              scoreMemoryMatch(candidate.content, item.content),
            ) >= SUPERSEDE_SCORE)
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
            content: item.content,
            importance: item.importance,
            recallCount: 0,
            lastRecalledAt: null,
            createdAt: now,
            updatedAt: now,
            deletedAt: null,
          }).returning()

          stored.push({ id: created!.id, created: true })
        }
        return stored
      })
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
