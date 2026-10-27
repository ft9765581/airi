import type { Database } from '../../libs/db'
import type { MemoryCategory } from './memory-category'
import type { MemoryEmbedder } from './memory-embedding'

import { useLogger } from '@guiiai/logg'
import { and, cosineDistance, desc, eq, gte, inArray, isNotNull, isNull, lt, or, sql } from 'drizzle-orm'

import { nanoid } from '../../utils/id'
import { isMemoryCategory, memoryCategoryFromStored } from './memory-category'
import { MEMORY_EMBEDDING_DIMENSION } from './memory-embedding'
import { fusionRanks, memoryOverlap, MIN_MATCH_SCORE, MIN_VECTOR_SCORE, reciprocalRankFusion, scoreMemoryMatch, SUPERSEDE_SCORE } from './user-memory-match'
import { mergeProfileWithMemories } from './user-memory-profile'
import { createUserRuntimeService, normalizeClientTimestamp } from './user-runtime'
import { startOfZonedDay } from './zoned-day'

import * as schema from '../../schemas/user-memory'

export type { MemoryCategory } from './memory-category'
export { scoreMemoryMatch } from './user-memory-match'

const logger = useLogger('user-memory')

/** How many recent facts one search reads before it ranks them. */
const CANDIDATE_LIMIT = 200
/** How many nearest vectors one search reads from vchord before it ranks them. */
const VECTOR_CANDIDATE_LIMIT = 40
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

function readSimilarity(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric))
    return 0
  return numeric
}

function visibleMemoryFilter(ownerId: string, characterId: string) {
  return and(
    eq(schema.userMemories.ownerId, ownerId),
    isNull(schema.userMemories.deletedAt),
    or(
      eq(schema.userMemories.scope, 'user'),
      and(
        eq(schema.userMemories.scope, 'character'),
        eq(schema.userMemories.characterId, characterId),
      ),
    ),
  )
}

/**
 * Embeds one fact.
 *
 * A missing vector, a wrong length, or a provider error returns null. The fact
 * is still stored, and search for that request uses words only.
 */
async function embedFact(embedder: MemoryEmbedder, text: string): Promise<number[] | null> {
  try {
    const vector = await embedder.embed(text)
    if (!vector || vector.length !== MEMORY_EMBEDDING_DIMENSION)
      return null
    if (vector.some(value => !Number.isFinite(value)))
      return null
    return vector
  }
  catch (error) {
    logger.withError(error).warn('Memory embedding failed')
    return null
  }
}

function toRecord(row: typeof schema.userMemories.$inferSelect): MemoryRecord {
  const scope: MemoryScope = row.scope === 'character' ? 'character' : 'user'
  return {
    id: row.id,
    characterId: row.characterId,
    scope,
    category: memoryCategoryFromStored(row.category),
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
 * fact stays on the card that learned it. Search lowers the weight of facts
 * that are old and rarely recalled. A later fact that shares most of its words
 * replaces the older one. Once a day, user facts from earlier days are folded
 * into the account profile. Account deletion marks the rows deleted. An empty
 * result leaves the chat prompt unchanged.
 *
 * When the embedder returns a vector, search reads every day. Words and cosine
 * each make one ranked list. Reciprocal rank fusion adds the lists, then the
 * time weight scales the fused score. Cosine order uses `embedding <=> query`
 * so Postgres can use the vchordrq index. When the embedder returns null,
 * search stays on the local calendar day and uses the word list only.
 */
export function createUserMemoryService(db: Database, embedder: MemoryEmbedder = {
  async embed() {
    return null
  },
}) {
  return {
    /**
     * Returns up to five facts for this user and character card.
     *
     * User-scoped facts apply on every card. Character-scoped facts apply only
     * on the card that stored them. A fact enters when its words overlap enough
     * or its vector is close enough. A fact on both lists ranks above a fact on
     * one list. Each returned fact counts one recall, so the next search keeps
     * it longer.
     */
    async search(ownerId: string, characterId: string, query: string, now = new Date(), timeZone = 'UTC'): Promise<MemoryRecord[]> {
      const trimmed = query.trim()
      if (trimmed.length < 2 || !characterId)
        return []

      const queryVector = await embedFact(embedder, trimmed)
      const scope = visibleMemoryFilter(ownerId, characterId)
      if (!scope)
        return []

      const recentFilters = [scope]
      if (!queryVector)
        recentFilters.push(gte(schema.userMemories.createdAt, startOfZonedDay(timeZone, now)))

      const recent = await db.select().from(schema.userMemories).where(and(...recentFilters)).orderBy(desc(schema.userMemories.createdAt)).limit(CANDIDATE_LIMIT)

      const byId = new Map<string, { row: typeof schema.userMemories.$inferSelect, similarity: number }>()
      for (const row of recent)
        byId.set(row.id, { row, similarity: 0 })

      if (queryVector) {
        const distance = cosineDistance(schema.userMemories.embedding, queryVector)
        const nearest = await db.select({
          id: schema.userMemories.id,
          ownerId: schema.userMemories.ownerId,
          characterId: schema.userMemories.characterId,
          scope: schema.userMemories.scope,
          category: schema.userMemories.category,
          content: schema.userMemories.content,
          importance: schema.userMemories.importance,
          recallCount: schema.userMemories.recallCount,
          lastRecalledAt: schema.userMemories.lastRecalledAt,
          createdAt: schema.userMemories.createdAt,
          updatedAt: schema.userMemories.updatedAt,
          deletedAt: schema.userMemories.deletedAt,
          consolidatedAt: schema.userMemories.consolidatedAt,
          embedding: schema.userMemories.embedding,
          similarity: sql<number>`1 - (${distance})`,
        }).from(schema.userMemories).where(and(
          scope,
          isNotNull(schema.userMemories.embedding),
        )).orderBy(distance).limit(VECTOR_CANDIDATE_LIMIT)

        for (const hit of nearest) {
          const { similarity, ...row } = hit
          const existing = byId.get(row.id)
          const score = readSimilarity(similarity)
          if (existing)
            existing.similarity = score
          else
            byId.set(row.id, { row, similarity: score })
        }
      }

      // Two lists, then reciprocal rank fusion. Equal word scores share a rank
      // so the time weight still breaks that tie.
      const scored = [...byId.values()].map(entry => ({
        row: entry.row,
        lexical: scoreMemoryMatch(trimmed, entry.row.content),
        similarity: entry.similarity,
        weight: memoryWeight(entry.row, now),
      }))
      const lexicalHits = scored.filter(entry => entry.lexical >= MIN_MATCH_SCORE)
      const vectorHits = scored.filter(entry => entry.similarity >= MIN_VECTOR_SCORE)
      const fused = reciprocalRankFusion([
        fusionRanks(lexicalHits, entry => entry.row.id, entry => entry.lexical),
        fusionRanks(vectorHits, entry => entry.row.id, entry => entry.similarity),
      ])
      const ranked = scored
        .flatMap((entry) => {
          const fusedScore = fused.get(entry.row.id)
          if (fusedScore == null)
            return []
          return [{ ...entry, score: fusedScore * entry.weight }]
        })
        .sort((left, right) => {
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

      const prepared = await Promise.all(accepted.map(async item => ({
        ...item,
        embedding: await embedFact(embedder, item.content),
      })))

      return await db.transaction(async (tx) => {
        const stored: RememberedMemory[] = []
        for (const item of prepared) {
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
              ...(item.embedding ? { embedding: item.embedding } : {}),
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
            embedding: item.embedding,
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

      const embedding = await embedFact(embedder, content)
      const [existing] = await db.select().from(schema.userMemories).where(and(
        eq(schema.userMemories.id, memoryId),
        eq(schema.userMemories.ownerId, ownerId),
        isNull(schema.userMemories.deletedAt),
      ))
      if (!existing)
        return null

      const scope: MemoryScope = existing.scope === 'character' ? 'character' : 'user'
      const storedCategory = memoryCategoryFromStored(existing.category) ?? undefined
      const [updated] = await db.update(schema.userMemories).set({
        content,
        category: categoryFor(scope, input.category ?? storedCategory),
        updatedAt: now,
        ...(embedding ? { embedding } : {}),
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
        category: memoryCategoryFromStored(row.category) ?? 'other',
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
