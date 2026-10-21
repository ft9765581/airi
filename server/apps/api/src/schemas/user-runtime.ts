import { jsonb, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core'

// NOTICE: bare ownerId is intentional — no FK to user.id. better-auth hard-deletes
// the user row; a cascade would wipe these soft-delete archive rows.
// See `server/apps/api/docs/ai-context/account-deletion.md`.
//
// These rows are the signed-in user's runtime character setup. They are not
// the public `characters` catalog (likes, covers, price).

export const userRuntimeCards = pgTable(
  'user_runtime_cards',
  {
    ownerId: text('owner_id').notNull(),
    cardId: text('card_id').notNull(),
    card: jsonb('card').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  table => [
    primaryKey({ columns: [table.ownerId, table.cardId] }),
  ],
)

export const userRuntimeSettings = pgTable(
  'user_runtime_settings',
  {
    ownerId: text('owner_id').primaryKey(),
    activeCardId: text('active_card_id').notNull(),
    activeCardUpdatedAt: timestamp('active_card_updated_at', { withTimezone: true }).notNull(),
    profileContent: text('profile_content').notNull().default(''),
    profileUpdatedAt: timestamp('profile_updated_at', { withTimezone: true }).notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
)
