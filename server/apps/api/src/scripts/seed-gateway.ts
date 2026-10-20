/**
 * Seeds the model gateway that this deployment serves.
 *
 * The gateway reads three things that no HTTP API creates:
 *
 * 1. `LLM_ROUTER_CONFIG` in `config_kv` — the per-model upstream list.
 * 2. A row in `capability_aliases` — the name a client sends as `model`.
 * 3. Rows in `capability_alias_routes` — which router models that alias reaches.
 *
 * Writing them by hand does not work: an upstream key is stored as envelope
 * ciphertext bound to its model name and key-entry id, so a plaintext key in the
 * table would fail to decrypt.
 *
 * The script is idempotent. It replaces the router config every run, and it
 * inserts the alias and its routes only when they are absent, so a second run
 * cannot duplicate them.
 *
 * Call stack:
 *
 * seedGateway
 *   -> {@link createEnvelopeCrypto} (encrypts the upstream key)
 *   -> `llmRouterConfigSchema` (validates before writing)
 *   -> `config_kv` upsert
 *   -> `capability_aliases` + `capability_alias_routes` upsert
 *   -> Redis cache invalidation
 *
 * Run with `pnpm -F @proj-airi/api-server run seed:gateway`.
 */

import process from 'node:process'

import { Buffer } from 'node:buffer'

import Redis from 'ioredis'

import { nanoid } from 'nanoid'
import { Client } from 'pg'
import { parse } from 'valibot'

import { configKVCacheKey } from '../services/adapters/config-kv/contracts'
import { llmRouterConfigSchema } from '../services/adapters/config-kv/definitions'
import { createEnvelopeCrypto } from '../utils/envelope-crypto'

/** Router model id. The alias routes to this, and `LLM_ROUTER_CONFIG` defines it. */
const ROUTER_MODEL_ID = process.env.GATEWAY_MODEL_ID ?? 'deepseek-flash'

/**
 * Alias id that a client sends as `model`.
 *
 * `provider-catalog` insists on this value: it rejects any other alias id with
 * `CAPABILITY_ALIAS_NOT_FOUND`, so the value is not a choice.
 */
const ALIAS_ID = 'auto'

/** Upstream key entry id. It must not contain `|`, the envelope AAD separator. */
const KEY_ENTRY_ID = 'primary'

function required(name: string): string {
  const value = process.env[name]?.trim()
  if (!value)
    throw new Error(`${name} is required`)
  return value
}

async function main(): Promise<void> {
  const databaseUrl = required('DATABASE_URL')
  const redisUrl = required('REDIS_URL')
  const masterKeyB64 = required('LLM_ROUTER_MASTER_KEY')
  const deepseekApiKey = required('DEEPSEEK_API_KEY')

  const baseURL = process.env.DEEPSEEK_BASE_URL?.trim() || 'https://api.deepseek.com/v1'

  const masterKey = Buffer.from(masterKeyB64, 'base64')
  const crypto = createEnvelopeCrypto({ masterKey })

  // The AAD binds the ciphertext to this exact (model, key entry) pair, so the
  // id used here must match the one written into the config below.
  const ciphertext = crypto.encryptKey(deepseekApiKey, {
    modelName: ROUTER_MODEL_ID,
    keyEntryId: KEY_ENTRY_ID,
  })

  // Validate before writing. A config that violates the schema would make every
  // gateway request fail with CONFIG_INVALID instead of failing here.
  const routerConfig = parse(llmRouterConfigSchema, {
    llm: {
      models: {
        [ROUTER_MODEL_ID]: {
          upstreams: [
            {
              id: 'deepseek',
              baseURL,
              keys: [{ id: KEY_ENTRY_ID, ciphertext }],
            },
          ],
        },
      },
    },
    // Required by the schema. Empty because this deployment serves no TTS
    // through the gateway yet.
    tts: { models: {} },
    defaults: {},
  })

  const db = new Client({ connectionString: databaseUrl })
  const redis = new Redis(redisUrl, { maxRetriesPerRequest: 2, lazyConnect: true })

  try {
    await db.connect()
    await redis.connect()

    await db.query('begin')

    await db.query(
      `insert into config_kv (key, value, updated_at)
       values ($1, $2, now())
       on conflict (key) do update set value = excluded.value, updated_at = now()`,
      ['LLM_ROUTER_CONFIG', JSON.stringify(routerConfig)],
    )

    // `capability_aliases` keys on (surface, alias_id); `capability_alias_routes`
    // references the row id, not the alias name.
    const alias = await db.query<{ id: string }>(
      `insert into capability_aliases (id, surface, alias_id, display_name)
       values ($1, 'llm', $2, $3)
       on conflict (surface, alias_id) do update set updated_at = now()
       returning id`,
      [nanoid(), ALIAS_ID, 'Automatic'],
    )
    const aliasRowId = alias.rows[0]?.id
    if (!aliasRowId)
      throw new Error('capability_aliases upsert returned no row')

    await db.query(
      `insert into capability_alias_routes (id, alias_id, router_model_id, pool, display_order)
       values ($1, $2, $3, 'primary', 0)
       on conflict (alias_id, router_model_id, pool) do update set updated_at = now()`,
      [nanoid(), aliasRowId, ROUTER_MODEL_ID],
    )

    await db.query('commit')

    // The store caches a 300s copy in Redis. Drop it so the running process
    // reads the row that was just written.
    await redis.del(configKVCacheKey('LLM_ROUTER_CONFIG'))

    const masked = `${deepseekApiKey.slice(0, 6)}…${deepseekApiKey.slice(-4)}`
    process.stdout.write([
      'Gateway seeded.',
      `  router model : ${ROUTER_MODEL_ID}`,
      `  upstream     : ${baseURL}`,
      `  key          : ${masked}`,
      `  alias        : ${ALIAS_ID} -> ${ROUTER_MODEL_ID}`,
      '',
      `A client now sends { "model": "${ALIAS_ID}" }.`,
      '',
    ].join('\n'))
  }
  catch (error) {
    await db.query('rollback').catch(() => {})
    throw error
  }
  finally {
    await db.end().catch(() => {})
    redis.disconnect()
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(1)
})
