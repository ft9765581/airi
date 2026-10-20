import { env } from 'node:process'

import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  // One entry point: `src/schemas/index.ts` re-exports every table module and
  // `@proj-airi/auth-shared`. A glob over the directory would also load the
  // `.test.ts` files beside them, and drizzle-kit requires schema modules through
  // CommonJS, which fails on their vitest import.
  schema: ['./src/schemas/index.ts'],
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: env.DATABASE_URL!,
  },
  // https://github.com/drizzle-team/drizzle-orm/issues/4008
  tablesFilter: ['!vchordrq_sampled_queries'],
})
