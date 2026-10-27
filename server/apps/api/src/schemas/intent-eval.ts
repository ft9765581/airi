import type { InferInsertModel, InferSelectModel } from 'drizzle-orm'

import { randomUUID } from 'node:crypto'

import { index, integer, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core'

/**
 * The labelled intent samples one person keeps for evaluation.
 *
 * `userId` is a bare column with no foreign key, matching the rest of the
 * account-owned tables: better-auth hard-deletes the user row, and a cascade
 * would take the evaluation history with it.
 *
 * The label is data a person wrote, so `labelStatus` stays separate from
 * `expected`: an unreviewed label is a guess, and a run must not read it as a
 * confirmed answer.
 */
export const intentSamples = pgTable(
  'intent_samples',
  {
    id: text('id').primaryKey().$defaultFn(() => randomUUID()),
    userId: text('user_id').notNull(),
    /** The message to classify. Synthetic or de-identified: never a real user turn. */
    input: text('input').notNull(),
    /**
     * The earlier turns this sample depends on, in order.
     *
     * `jsonb` rather than columns: a follow-up can need a user turn, an
     * assistant turn, or both, and dropping the assistant turn changes what the
     * sentence means.
     */
    context: jsonb('context'),
    /** The slice this sample measures, e.g. `medical-explicit`, `chitchat`. */
    group: text('group').notNull(),
    /**
     * The human label: `medical` or `chat`, or nothing until someone labels it.
     *
     * An unlabelled sample is a collected sentence, not an answer: a batch run
     * skips it and keeps it out of every denominator.
     */
    expected: text('expected'),
    /** `unreviewed` or `reviewed`. Only reviewed labels may reach a release report. */
    labelStatus: text('label_status').notNull().default('unreviewed'),
    /** Where the sample came from, for a reader who has to judge it later. */
    source: text('source'),
    /** The collection this sample belongs to, when the page has created one. */
    collectionId: text('collection_id'),
    /** The set version this label belongs to. Runs record the version they read. */
    sampleSetVersion: integer('sample_set_version').notNull().default(1),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
    deletedAt: timestamp('deleted_at'),
  },
  table => [
    index('intent_samples_owner_idx').on(table.userId, table.deletedAt),
    index('intent_samples_set_idx').on(table.userId, table.sampleSetVersion),
  ],
)

export type IntentSampleRow = InferSelectModel<typeof intentSamples>
export type NewIntentSampleRow = InferInsertModel<typeof intentSamples>

/**
 * One batch evaluation run and what it read.
 *
 * Per-sample verdicts live in `cases` rather than in a child table: a run is an
 * immutable record of one configuration, and a report has to keep showing the
 * samples and labels it ran against even after the sample set is edited.
 *
 * `status` carries the run's lifecycle, because a batch over hundreds of samples
 * outlives one request: a client reports progress, and a cancelled or failed run
 * must still say how many samples it finished.
 */
export const intentRuns = pgTable(
  'intent_runs',
  {
    id: text('id').primaryKey().$defaultFn(() => randomUUID()),
    userId: text('user_id').notNull(),
    /** The sample set version this run read. */
    sampleSetVersion: integer('sample_set_version').notNull(),
    /** `rules`, `model` or `compare`. */
    mode: text('mode').notNull(),
    /** `running`, `completed`, `failed` or `cancelled`. */
    status: text('status').notNull().default('running'),
    /** Mode, set version, model and prompt digest: two runs compare only when equal. */
    configKey: text('config_key').notNull(),
    modelId: text('model_id'),
    /** Digest of the classifier prompt, never the prompt itself. */
    classifierPromptDigest: text('classifier_prompt_digest'),
    /** Samples the run planned to cover. */
    total: integer('total').notNull().default(0),
    /** Samples finished so far. A cancelled run keeps this and says so. */
    completed: integer('completed').notNull().default(0),
    /** Per-method metrics, validated when read. */
    metrics: jsonb('metrics'),
    /** Per-sample verdicts and the sample snapshot, validated when read. */
    cases: jsonb('cases'),
    /** Why the run stopped early, in the words of the caller that stopped it. */
    failureReason: text('failure_reason'),
    startedAt: timestamp('started_at').defaultNow().notNull(),
    finishedAt: timestamp('finished_at'),
    /** Set on account deletion, so history disappears with its owner. */
    deletedAt: timestamp('deleted_at'),
  },
  table => [
    index('intent_runs_owner_idx').on(table.userId, table.deletedAt),
  ],
)

export type IntentRunRow = InferSelectModel<typeof intentRuns>
export type NewIntentRunRow = InferInsertModel<typeof intentRuns>

/**
 * A named collection of samples.
 *
 * A collection is what a person picks before a batch run, so `name` is the label
 * they see and `purpose` only separates the development set from the acceptance
 * set. Purpose grants no permission and freezes nothing (intent-routing.md §7.6).
 */
export const intentCollections = pgTable(
  'intent_collections',
  {
    id: text('id').primaryKey().$defaultFn(() => randomUUID()),
    userId: text('user_id').notNull(),
    name: text('name').notNull(),
    /** `development` or `acceptance`. */
    purpose: text('purpose').notNull().default('development'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
    deletedAt: timestamp('deleted_at'),
  },
  table => [
    index('intent_collections_owner_idx').on(table.userId, table.deletedAt),
  ],
)

export type IntentCollectionRow = InferSelectModel<typeof intentCollections>
export type NewIntentCollectionRow = InferInsertModel<typeof intentCollections>
