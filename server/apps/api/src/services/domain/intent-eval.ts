import type { Database } from '../../libs/db'

import { and, desc, eq, isNull } from 'drizzle-orm'
import { parse } from 'valibot'

import { RunCasesSchema, RunMetricsSchema } from '../../schemas/intent-eval-contract'

import * as schema from '../../schemas/intent-eval'

/**
 * The labelled samples and the batch runs one person keeps.
 *
 * Every method takes the caller's `userId` and filters on it. A resource that is
 * not the caller's is reported as missing rather than forbidden, so an id cannot
 * be probed for existence.
 *
 * Stored JSON is validated on read: a column can hold a shape written by an older
 * build, and a report must not pass it to a client as if it were current.
 */

/** One sample as a client may create it. The route validates the body first. */
export interface IntentSampleInput {
  input: string
  previous?: string
  group: string
  expected: 'medical' | 'chat'
  labelStatus?: 'unreviewed' | 'reviewed'
  source?: string
  sampleSetVersion?: number
}

/** What a client may change on a sample. */
export type IntentSamplePatch = Partial<IntentSampleInput>

/** One run as a client creates it. Metrics and cases arrive as the run progresses. */
export interface IntentRunInput {
  sampleSetVersion: number
  mode: 'rules' | 'model' | 'compare' | 'embedding'
  configKey: string
  modelId?: string
  classifierPromptDigest?: string
  embeddingEndpoint?: string
  embeddingModel?: string
  embeddingMargin?: string
  total: number
}

/** What a client may report about a run. */
export interface IntentRunPatch {
  status?: 'running' | 'completed' | 'failed' | 'cancelled'
  completed?: number
  metrics?: unknown
  cases?: unknown
  failureReason?: string
}

/** The statuses after which a run does not change again. */
const terminalStatuses = new Set(['completed', 'failed', 'cancelled'])

export function createIntentEvalService(db: Database) {
  /** One row as the API returns it, with the stored JSON validated. */
  function toRun(row: schema.IntentRunRow) {
    return {
      ...row,
      metrics: row.metrics == null ? null : parse(RunMetricsSchema, row.metrics),
      cases: row.cases == null ? null : parse(RunCasesSchema, row.cases),
    }
  }

  return {
    async listSamples(userId: string) {
      return await db.query.intentSamples.findMany({
        where: and(eq(schema.intentSamples.userId, userId), isNull(schema.intentSamples.deletedAt)),
        orderBy: [desc(schema.intentSamples.createdAt)],
      })
    },

    async createSample(userId: string, input: IntentSampleInput) {
      const [row] = await db.insert(schema.intentSamples).values({
        userId,
        input: input.input,
        previous: input.previous,
        group: input.group,
        expected: input.expected,
        labelStatus: input.labelStatus,
        source: input.source,
        sampleSetVersion: input.sampleSetVersion,
      }).returning()

      return row
    },

    /** Imports a batch in one statement, so a rejected row rejects the whole file. */
    async createSamples(userId: string, inputs: IntentSampleInput[]) {
      if (!inputs.length)
        return []

      return await db.insert(schema.intentSamples).values(inputs.map(input => ({
        userId,
        input: input.input,
        previous: input.previous,
        group: input.group,
        expected: input.expected,
        labelStatus: input.labelStatus,
        source: input.source,
        sampleSetVersion: input.sampleSetVersion,
      }))).returning()
    },

    async updateSample(userId: string, id: string, patch: IntentSamplePatch) {
      const [row] = await db.update(schema.intentSamples)
        .set({ ...patch, updatedAt: new Date() })
        .where(and(
          eq(schema.intentSamples.id, id),
          eq(schema.intentSamples.userId, userId),
          isNull(schema.intentSamples.deletedAt),
        ))
        .returning()

      return row
    },

    /** Soft delete: a run that already read this sample keeps its own snapshot. */
    async deleteSample(userId: string, id: string) {
      const [row] = await db.update(schema.intentSamples)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(and(
          eq(schema.intentSamples.id, id),
          eq(schema.intentSamples.userId, userId),
          isNull(schema.intentSamples.deletedAt),
        ))
        .returning()

      return row
    },

    async listRuns(userId: string, limit = 20) {
      const rows = await db.query.intentRuns.findMany({
        where: and(eq(schema.intentRuns.userId, userId), isNull(schema.intentRuns.deletedAt)),
        orderBy: [desc(schema.intentRuns.startedAt)],
        limit,
      })

      return rows.map(toRun)
    },

    async getRun(userId: string, id: string) {
      const row = await db.query.intentRuns.findFirst({
        where: and(
          eq(schema.intentRuns.id, id),
          eq(schema.intentRuns.userId, userId),
          isNull(schema.intentRuns.deletedAt),
        ),
      })

      return row ? toRun(row) : undefined
    },

    async createRun(userId: string, input: IntentRunInput) {
      const [row] = await db.insert(schema.intentRuns).values({
        userId,
        sampleSetVersion: input.sampleSetVersion,
        mode: input.mode,
        configKey: input.configKey,
        modelId: input.modelId,
        classifierPromptDigest: input.classifierPromptDigest,
        embeddingEndpoint: input.embeddingEndpoint,
        embeddingModel: input.embeddingModel,
        embeddingMargin: input.embeddingMargin,
        total: input.total,
      }).returning()

      return toRun(row)
    },

    /**
     * Reports progress or the final numbers of a run.
     *
     * A terminal status also stamps `finishedAt`: the page shows how long a run
     * took, and a finished run must not look like it is still going.
     */
    async updateRun(userId: string, id: string, patch: IntentRunPatch) {
      const [row] = await db.update(schema.intentRuns)
        .set({
          ...patch,
          ...(patch.status && terminalStatuses.has(patch.status) ? { finishedAt: new Date() } : {}),
        })
        .where(and(
          eq(schema.intentRuns.id, id),
          eq(schema.intentRuns.userId, userId),
          isNull(schema.intentRuns.deletedAt),
        ))
        .returning()

      return row ? toRun(row) : undefined
    },

    /**
     * Removes everything this module holds for one account.
     *
     * Called by the account-deletion scheduler. Both tables hold text a person
     * wrote or was shown, so both are soft-deleted in one transaction: a half
     * cleanup would leave one of them readable after the account is gone.
     */
    async deleteAllForUser(userId: string) {
      const now = new Date()

      return await db.transaction(async (tx) => {
        const samples = await tx.update(schema.intentSamples)
          .set({ deletedAt: now, updatedAt: now })
          .where(and(
            eq(schema.intentSamples.userId, userId),
            isNull(schema.intentSamples.deletedAt),
          ))
          .returning({ id: schema.intentSamples.id })

        const runs = await tx.update(schema.intentRuns)
          .set({ deletedAt: now })
          .where(and(
            eq(schema.intentRuns.userId, userId),
            isNull(schema.intentRuns.deletedAt),
          ))
          .returning({ id: schema.intentRuns.id })

        return { samples: samples.length, runs: runs.length }
      })
    },
  }
}

export type IntentEvalService = ReturnType<typeof createIntentEvalService>
