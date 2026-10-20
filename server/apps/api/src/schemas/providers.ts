import type { InferInsertModel, InferSelectModel } from 'drizzle-orm'

import { user } from '@proj-airi/auth-shared'
import { relations } from 'drizzle-orm'
import { boolean, jsonb, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core'

import { nanoid } from '../utils/id'

// NOTICE: bare ownerId is intentional — no FK to user.id. better-auth hard-deletes
// the user row; a cascade would wipe these soft-delete archive rows.
// See `server/apps/api/docs/ai-context/account-deletion.md`.
//
// The primary key is `(owner_id, id)`, not `id`. A client keeps a stable provider
// id such as `deepseek` in its module selections, so every account stores the same
// id for the same source. A global `id` key let the first account claim those ids
// and made every later account fail to upload its providers with a duplicate-key
// error.
export const userProviderConfigs = pgTable(
  'user_provider_configs',
  {
    id: text('id').notNull().$defaultFn(() => nanoid()),
    ownerId: text('owner_id').notNull(),
    definitionId: text('definition_id').notNull(),
    name: text('name').notNull(),
    config: jsonb('config').notNull().default({}),
    validated: boolean('validated').notNull().default(false),
    validationBypassed: boolean('validation_bypassed').notNull().default(false),

    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
    deletedAt: timestamp('deleted_at'),
  },
  table => [
    primaryKey({ columns: [table.ownerId, table.id] }),
  ],
)

export type UserProviderConfig = InferSelectModel<typeof userProviderConfigs>
export type NewUserProviderConfig = InferInsertModel<typeof userProviderConfigs>

export const userProviderConfigsRelations = relations(
  userProviderConfigs,
  ({ one }) => ({
    owner: one(user, {
      fields: [userProviderConfigs.ownerId],
      references: [user.id],
    }),
  }),
)

export const systemProviderConfigs = pgTable(
  'system_provider_configs',
  {
    id: text('id').primaryKey().$defaultFn(() => nanoid()),
    definitionId: text('definition_id').notNull(),
    name: text('name').notNull(),
    config: jsonb('config').notNull().default({}),
    validated: boolean('validated').notNull().default(false),
    validationBypassed: boolean('validation_bypassed').notNull().default(false),

    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
    deletedAt: timestamp('deleted_at'),
  },
)

export type SystemProviderConfig = InferSelectModel<typeof systemProviderConfigs>
export type NewSystemProviderConfig = InferInsertModel<typeof systemProviderConfigs>
