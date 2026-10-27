import type { InferOutput } from 'valibot'

import { Buffer } from 'node:buffer'
import { env, exit } from 'node:process'

import { useLogger } from '@guiiai/logg'
import { injeca } from 'injeca'
import { array, check, integer, maxValue, minValue, nonEmpty, object, optional, parse, picklist, pipe, string, transform, url } from 'valibot'

const AdditionalTrustedOriginsSchema = pipe(
  string(),
  transform(raw => raw.split(',').map(origin => origin.trim()).filter(Boolean)),
  array(pipe(
    string(),
    url('ADDITIONAL_TRUSTED_ORIGINS entries must be valid URLs'),
    transform(origin => new URL(origin).origin),
  )),
  transform(origins => [...new Set(origins)]),
)

function optionalIntegerFromString(defaultValue: number, envKey: string, minimum: number) {
  return optional(
    pipe(
      string(),
      nonEmpty(`${envKey} must not be empty`),
      transform(input => Number(input)),
      integer(`${envKey} must be an integer`),
      minValue(minimum, `${envKey} must be at least ${minimum}`),
    ),
    String(defaultValue),
  )
}

function optionalNumberFromString(defaultValue: number, envKey: string, minimum: number, maximum: number) {
  return optional(
    pipe(
      string(),
      nonEmpty(`${envKey} must not be empty`),
      transform(input => Number(input)),
      minValue(minimum, `${envKey} must be at least ${minimum}`),
      maxValue(maximum, `${envKey} must be at most ${maximum}`),
    ),
    String(defaultValue),
  )
}

const EnvSchema = object({
  // Comma-separated exact origins (e.g. Capacitor dev server `https://10.x:5273`).
  // Prefer this over broad private-IP regex heuristics in production-like configs.
  ADDITIONAL_TRUSTED_ORIGINS: optional(
    AdditionalTrustedOriginsSchema,
    '',
  ),
  API_SERVER_URL: optional(string(), 'http://localhost:3000'),

  AUTH_SERVER_INTERNAL_URL: optional(string()),
  AUTH_SERVER_URL: optional(string(), 'http://localhost:3000'),
  DATABASE_URL: pipe(string(), nonEmpty('DATABASE_URL is required')),

  DB_POOL_CONNECTION_TIMEOUT_MS: optionalIntegerFromString(5000, 'DB_POOL_CONNECTION_TIMEOUT_MS', 1),

  DB_POOL_IDLE_TIMEOUT_MS: optionalIntegerFromString(30000, 'DB_POOL_IDLE_TIMEOUT_MS', 1),

  DB_POOL_KEEPALIVE_INITIAL_DELAY_MS: optionalIntegerFromString(10000, 'DB_POOL_KEEPALIVE_INITIAL_DELAY_MS', 1),
  // Database pool
  DB_POOL_MAX: optionalIntegerFromString(20, 'DB_POOL_MAX', 1),

  HOST: optional(string(), '0.0.0.0'),
  // Envelope-encryption master key for in-process LLM/TTS router (KTD-5).
  // Stored as base64-encoded 32 random bytes. Validator decodes + asserts the
  // 32-byte length at parse time so a misconfigured key fails the deploy
  // rather than passing readiness and breaking on first router request.
  // Required: the router has no fallback path, so an unset master key means
  // chat completions cannot serve at all.
  LLM_ROUTER_MASTER_KEY: pipe(
    string(),
    nonEmpty('LLM_ROUTER_MASTER_KEY is required'),
    transform(b64 => Buffer.from(b64, 'base64')),
    check(buf => buf.length === 32, 'LLM_ROUTER_MASTER_KEY must decode to exactly 32 bytes (base64-encoded 32-byte random)'),
  ),
  // Optional second master key used only during rotation: encrypts under
  // LLM_ROUTER_MASTER_KEY (new), retries decrypt against LLM_ROUTER_MASTER_KEY_PREVIOUS
  // (old). Drop after re-encrypting every stored ciphertext.
  LLM_ROUTER_MASTER_KEY_PREVIOUS: optional(pipe(
    string(),
    nonEmpty('LLM_ROUTER_MASTER_KEY_PREVIOUS must not be empty when set'),
    transform(b64 => Buffer.from(b64, 'base64')),
    check(buf => buf.length === 32, 'LLM_ROUTER_MASTER_KEY_PREVIOUS must decode to exactly 32 bytes when set'),
  )),
  /**
   * Whether the OpenAI-compatible gateway prices a completion against the
   * caller's Flux balance.
   *
   * `enforce` is the upstream behavior. `off` serves every caller without a
   * balance, which is what a deployment that never sells credits needs: the
   * balance is always zero there, so `enforce` would answer 402 to everyone.
   * @default 'enforce'
   */
  OPENAI_GATEWAY_BILLING_MODE: optional(picklist(['enforce', 'off']), 'enforce'),
  /**
   * Knowledge base retrieval endpoint that this API forwards for the browser.
   *
   * A knowledge base service usually refuses a browser origin, and a key placed
   * in the bundle is public. Forwarding through this process removes both
   * problems: the call becomes server-to-server, and the key stays here.
   *
   * Empty disables the endpoint, which then answers 503
   * `KNOWLEDGE_BASE_NOT_CONFIGURED`.
   */
  KNOWLEDGE_BASE_URL: optional(string()),
  KNOWLEDGE_BASE_API_KEY: optional(string(), ''),
  /**
   * Which contract the knowledge service speaks.
   *
   * `dify` is the external knowledge base contract the browser already sends.
   * `demo` reads the same content through the service's read-only demo search
   * route, used while that deployment's external endpoint returns nothing.
   *
   * @default 'dify'
   */
  KNOWLEDGE_BASE_PROVIDER: optional(picklist(['dify', 'demo']), 'dify'),
  /**
   * Base URL the `demo` provider appends `/knowledge-bases/{id}/search` to.
   *
   * @default 'https://knowledge.bestmings.com/api/demo'
   */
  KNOWLEDGE_BASE_DEMO_BASE_URL: optional(string(), 'https://knowledge.bestmings.com/api/demo'),
  /** How long one forwarded retrieval may run before this API gives up. */
  KNOWLEDGE_BASE_TIMEOUT_MS: optionalIntegerFromString(8000, 'KNOWLEDGE_BASE_TIMEOUT_MS', 100),
  /**
   * OpenAI-compatible embeddings for long-term memory.
   *
   * An empty base URL or model leaves search on keyword overlap for the local day.
   * The stored column is `vector(1024)`. The endpoint must return 1024 numbers.
   * A call may send `dimensions: 1024`. When that call fails, the server tries once
   * more without `dimensions`, inside the same two-second limit.
   */
  MEMORY_EMBEDDING_API_KEY: optional(string(), ''),
  MEMORY_EMBEDDING_BASE_URL: optional(string(), ''),
  MEMORY_EMBEDDING_MODEL: optional(string(), ''),
  OTEL_DEBUG: optional(string()),

  OTEL_EXPORTER_OTLP_ENDPOINT: optional(string()),
  OTEL_EXPORTER_OTLP_HEADERS: optional(string()),

  // LLM/TTS gateway is fully internalised by the in-process router; provider
  // baseURLs live per-upstream inside LLM_ROUTER_CONFIG, and the default chat /
  // tts model aliases moved to configKV (DEFAULT_CHAT_MODEL / DEFAULT_TTS_MODEL)
  // so they're hot-swappable via Pub/Sub invalidation. No env entries needed
  // here.

  OTEL_SERVICE_NAME: optional(string(), 'server'),
  // OpenTelemetry
  OTEL_SERVICE_NAMESPACE: optional(string(), 'airi'),

  OTEL_TRACES_SAMPLING_RATIO: optionalNumberFromString(1, 'OTEL_TRACES_SAMPLING_RATIO', 0, 1),
  PORT: optionalIntegerFromString(3000, 'PORT', 1),
  POSTHOG_API_HOST: optional(string(), 'https://t.airi.build'),
  // PostHog product-event forwarding for server-confirmed funnel facts.
  // Defaults to the shared AIRI project key (same browser-safe phc_* key the
  // client surfaces embed in stage-shared/analytics/posthog), so forwarding is on out of
  // the box. Set to an empty string to disable server-side product analytics.
  POSTHOG_PROJECT_KEY: optional(string(), 'phc_pzjziJjrVZpa9SqnQqq0QEKvkmuCPH7GDTA6TbRTEf9'), // cspell:disable-line

  REDIS_URL: pipe(string(), nonEmpty('REDIS_URL is required')),
  STRIPE_SECRET_KEY: optional(string()),

  STRIPE_WEBHOOK_SECRET: optional(string()),
  // Testing-only bearer token bypass. Keep unset in production. When set,
  // Authorization: Bearer $TEST_AUTH_TOKEN resolves to the virtual user below
  // through resolveRequestAuth without creating an Auth session row.
  TEST_AUTH_TOKEN: optional(string(), ''),
  TEST_AUTH_USER_EMAIL: optional(pipe(string(), nonEmpty('TEST_AUTH_USER_EMAIL must not be empty when set')), 'test@example.com'),
  TEST_AUTH_USER_ID: optional(pipe(string(), nonEmpty('TEST_AUTH_USER_ID must not be empty when set')), 'test-user'),
  TEST_AUTH_USER_NAME: optional(pipe(string(), nonEmpty('TEST_AUTH_USER_NAME must not be empty when set')), 'Test User'),
  // Canonical user-facing web app origin. Used as the Stripe redirect base
  // (success_url / cancel_url / portal return_url) when a request has no trusted
  // browser origin — notably the Electron desktop renderer, which loads from
  // file:// and sends no usable web origin. Web/mobile requests keep returning to
  // their own origin; only origin-less clients fall back to this.
  WEB_APP_URL: optional(string(), 'https://airi.moeru.ai'),
})

export type Env = InferOutput<typeof EnvSchema>

export function parseEnv(inputEnv: Record<string, string> | typeof env): Env {
  try {
    return parse(EnvSchema, inputEnv)
  }
  catch (err) {
    useLogger().withError(err).error('Invalid environment variables')
    exit(1)
  }
}

export const parsedEnv = injeca.provide('env', () => parseEnv(env))
