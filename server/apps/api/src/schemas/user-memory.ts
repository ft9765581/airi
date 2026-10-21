import { index, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core'

import { nanoid } from '../utils/id'

// NOTICE: bare ownerId is intentional — no FK to user.id. better-auth hard-deletes
// the user row; a cascade would wipe these soft-delete archive rows.
// See `server/apps/api/docs/ai-context/account-deletion.md`.
//
// Each row is one short fact for a signed-in user. `scope` is `user` (about the
// person, every character card) or `character` (about one character card).
// These rows are not the public `characters` catalog.

export const userMemories = pgTable(
  'user_memories',
  {
    id: text('id').primaryKey().$defaultFn(() => nanoid()),
    ownerId: text('owner_id').notNull(),
    characterId: text('character_id').notNull(),
    scope: text('scope').notNull(),
    content: text('content').notNull(),
    importance: integer('importance').notNull(),
    recallCount: integer('recall_count').notNull().default(0),
    lastRecalledAt: timestamp('last_recalled_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  table => [
    index('user_memories_owner_created_idx').on(table.ownerId, table.createdAt),
  ],
)
