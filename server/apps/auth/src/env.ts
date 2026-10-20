import type { InferOutput } from 'valibot'

import { exit } from 'node:process'

import { useLogger } from '@guiiai/logg'
import { array, integer, minValue, nonEmpty, object, optional, parse, picklist, pipe, string, transform, url } from 'valibot'

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

const AuthEnvSchema = object({
  HOST: optional(string(), '0.0.0.0'),
  PORT: optionalIntegerFromString(3000, 'PORT', 1),
  PUBLIC_URL: optional(string(), 'http://localhost:3000'),
  RESOURCE_SERVER_URL: optional(string(), 'http://localhost:3001'),
  RATE_LIMIT_TRUSTED_PROXY: optional(picklist(['railway'])),
  // Request budget for `/api/auth/*`. The defaults match the former hard-coded
  // values and stay safe in a deployment. A local practice stack raises the
  // maximum so repeated sign-in attempts during testing do not hit 429.
  AUTH_RATE_LIMIT_MAX: optionalIntegerFromString(20, 'AUTH_RATE_LIMIT_MAX', 1),
  AUTH_RATE_LIMIT_WINDOW_SEC: optionalIntegerFromString(60, 'AUTH_RATE_LIMIT_WINDOW_SEC', 1),
  AUTH_UI_URL: optional(string(), 'https://accounts.airi.build/ui'),
  ADDITIONAL_TRUSTED_ORIGINS: optional(AdditionalTrustedOriginsSchema, ''),
  DATABASE_URL: pipe(string(), nonEmpty('DATABASE_URL is required')),
  REDIS_URL: pipe(string(), nonEmpty('REDIS_URL is required')),
  BETTER_AUTH_SECRET: pipe(string(), nonEmpty('BETTER_AUTH_SECRET is required')),
  // NOTICE:
  // This deployment signs users in with an email address and a password only, so
  // the social providers are optional. `auth.ts` registers a provider only when
  // its client ID is present. Set both values to enable Google or GitHub sign-in.
  // Removal condition: make them required again when the deployment serves only
  // social sign-in.
  AUTH_GOOGLE_CLIENT_ID: optional(string(), ''),
  AUTH_GOOGLE_CLIENT_SECRET: optional(string(), ''),
  AUTH_GITHUB_CLIENT_ID: optional(string(), ''),
  AUTH_GITHUB_CLIENT_SECRET: optional(string(), ''),
  AUTH_APPLE_CLIENT_ID: optional(string(), ''),
  AUTH_APPLE_APP_BUNDLE_IDENTIFIERS: optional(
    pipe(
      string(),
      transform(raw => [...new Set(
        raw
          .split(',')
          .map(bundleIdentifier => bundleIdentifier.trim())
          .filter(Boolean),
      )]),
    ),
    '',
  ),
  AUTH_APPLE_TEAM_ID: optional(string(), ''),
  AUTH_APPLE_KEY_ID: optional(string(), ''),
  AUTH_APPLE_PRIVATE_KEY_PEM: optional(
    pipe(
      string(),
      // Deployment dashboards commonly store multiline secrets with escaped
      // newlines. jose's PKCS8 importer requires the original PEM layout.
      transform(raw => raw.replaceAll(String.raw`\n`, '\n')),
    ),
    '',
  ),
  RESEND_API_KEY: optional(string(), ''),
  RESEND_FROM_EMAIL: optional(string(), 'noreply@airi.moeru.ai'),
  RESEND_FROM_NAME: optional(string(), 'Project AIRI'),
  DB_POOL_MAX: optionalIntegerFromString(20, 'DB_POOL_MAX', 1),
  DB_POOL_IDLE_TIMEOUT_MS: optionalIntegerFromString(30000, 'DB_POOL_IDLE_TIMEOUT_MS', 1),
  DB_POOL_CONNECTION_TIMEOUT_MS: optionalIntegerFromString(5000, 'DB_POOL_CONNECTION_TIMEOUT_MS', 1),
  DB_POOL_KEEPALIVE_INITIAL_DELAY_MS: optionalIntegerFromString(10000, 'DB_POOL_KEEPALIVE_INITIAL_DELAY_MS', 1),
  OTEL_SERVICE_NAME: optional(string(), 'auth-server'),
  OTEL_EXPORTER_OTLP_ENDPOINT: optional(string()),
})

/** Environment owned exclusively by the standalone Auth process. */
export type AuthEnv = InferOutput<typeof AuthEnvSchema>

/** Parses only Auth-owned configuration; business-only secrets are ignored. */
export function parseAuthEnv(inputEnv: Record<string, string> | NodeJS.ProcessEnv): AuthEnv {
  try {
    return parse(AuthEnvSchema, inputEnv)
  }
  catch (err) {
    useLogger().withError(err).error('Invalid auth environment variables')
    exit(1)
  }
}
