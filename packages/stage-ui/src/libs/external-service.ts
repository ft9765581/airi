import { errorMessageFrom } from '@moeru/std'

import { authedFetch } from './auth-fetch'
import { SERVER_URL } from './server'

/**
 * How this app sends one request to an outside HTTP service and explains a
 * failure.
 *
 * Two settings tabs probe an external service: the knowledge base and the
 * knowledge graph. The hard part of that probe is the same in both places, so it
 * lives here. The browser reports a blocked cross-origin request and an
 * unreachable host with one error, so it cannot name the cause; a second request
 * in `no-cors` mode is the only way to tell them apart. One implementation of
 * that rule is easier to trust than two.
 */

/** How long one request to an external service can run before AIRI stops it. */
export const serviceRequestTimeoutMs = 8000

/** Why a request to an external service did not complete. */
export type ServiceFailureKind = 'blocked-origin' | 'unreachable' | 'timeout'

/**
 * The error codes the knowledge service family reports in its response body.
 *
 * The knowledge base retrieval endpoint sends these with HTTP 200, so a caller
 * must read the body to learn that the call failed. The graph search endpoint
 * reports failures with a status code instead and uses none of them.
 */
export const knowledgeServiceErrorCodes = {
  authorizationFormat: 1001,
  authentication: 1002,
  /** The id the caller named is absent from the service. */
  resourceMissing: 2001,
} as const

/**
 * Where a connection's own key goes in the request.
 *
 * The two contracts of the knowledge service disagree: retrieval reads
 * `Authorization: Bearer`, graph search reads `X-API-Key`.
 */
export type ServiceCredentialHeader = 'authorization' | 'x-api-key'

/** One request to an external service, read as far as the transport allows. */
export interface ServiceResponse {
  /** True only when the service answered with a success status. */
  ok: boolean
  /** The status the service returned, when it answered. */
  httpStatus?: number
  /** Round-trip time in milliseconds. */
  latencyMs: number
  /** Why the request did not complete, when it did not complete. */
  failureKind?: ServiceFailureKind
  /** The runtime error message, for diagnostics. */
  errorMessage?: string
  /** The parsed body. Undefined when the service sent no JSON. */
  body: unknown
}

/** The values one request to an external service needs. */
export interface ServiceRequestInput {
  /** The endpoint address, as the user typed it. */
  baseUrl: string
  /** @default 'POST' */
  method?: 'GET' | 'POST'
  /**
   * Query parameters appended to the address.
   *
   * An empty string and `undefined` both leave the parameter out, so a form can
   * pass an optional field through unchanged.
   */
  query?: Record<string, string | number | undefined>
  /**
   * The credential of a third-party endpoint.
   *
   * This deployment's own API holds the service key and authorizes with the
   * session token, so the value is unused for that address.
   */
  apiKey?: string
  /** Which header carries `apiKey`. @default 'authorization' */
  credentialHeader?: ServiceCredentialHeader
  /** The JSON body that the service contract defines. Omit it for GET. */
  body?: Record<string, unknown>
  /** How long the request can run. @default serviceRequestTimeoutMs */
  timeoutMs?: number
}

/**
 * Adds a scheme when the user typed a bare host.
 *
 * A fetch call needs a scheme, and users often paste only the host. A bare host
 * becomes HTTPS. An address that already has a scheme stays as typed.
 *
 * @example
 * normalizeServiceUrl('kb.example.com/api/dify/retrieval')
 * // => 'https://kb.example.com/api/dify/retrieval'
 * @example
 * normalizeServiceUrl('http://localhost:8090/retrieval')
 * // => 'http://localhost:8090/retrieval'
 */
export function normalizeServiceUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim()
  if (!trimmed)
    return ''

  if (/^https?:\/\//i.test(trimmed))
    return trimmed

  return `https://${trimmed}`
}

/**
 * Reads one field of an untyped body, without trusting its shape.
 *
 * The services this app calls describe their answers in their own docs, not in a
 * schema this app can compile against, so every read starts here.
 */
export function readBodyField(source: unknown, key: string): unknown {
  if (typeof source !== 'object' || source === null)
    return undefined

  return (source as Record<string, unknown>)[key]
}

/** Reads one numeric field of an untyped body, or undefined when it is absent. */
export function readBodyNumber(source: unknown, key: string): number | undefined {
  const value = readBodyField(source, key)
  return typeof value === 'number' ? value : undefined
}

/** Reads one string field of an untyped body, or undefined when it is absent. */
export function readBodyString(source: unknown, key: string): string | undefined {
  const value = readBodyField(source, key)
  return typeof value === 'string' ? value : undefined
}

/** Reads one array field of an untyped body, or an empty array when it is absent. */
export function readBodyArray(source: unknown, key: string): unknown[] {
  const value = readBodyField(source, key)
  return Array.isArray(value) ? value : []
}

async function readJsonBody(response: Response): Promise<unknown> {
  try {
    return await response.json()
  }
  catch {
    // A service can answer with plain text or an empty body. The status code
    // still carries the result.
    return undefined
  }
}

/**
 * Tells a blocked request apart from an unreachable service.
 *
 * The browser rejects both cases with one error, so it cannot name the cause. A
 * second request in `no-cors` mode answers the question. The browser sends that
 * request as a simple request, so it needs no preflight. A resolved promise
 * therefore proves that the host answered, and only the cross-origin rule stopped
 * the first request.
 *
 * The probe uses `text/plain`, because `no-cors` permits only simple content
 * types. The service answers that request with an error, which is not read.
 */
async function classifyNetworkFailure(url: string, timeoutMs: number): Promise<ServiceFailureKind> {
  try {
    await fetch(url, {
      method: 'POST',
      mode: 'no-cors',
      body: 'ping',
      signal: AbortSignal.timeout(timeoutMs),
    })

    return 'blocked-origin'
  }
  catch {
    return 'unreachable'
  }
}

/**
 * Tells whether an endpoint is this deployment's own API.
 *
 * The deployment API's proxy routes require the session token and hold the
 * service key themselves, so a request to them must carry the token. Any other
 * endpoint is a third-party service and gets the connection's own key instead.
 */
function targetsDeploymentApi(url: string): boolean {
  try {
    return new URL(url).origin === new URL(SERVER_URL).origin
  }
  catch {
    return false
  }
}

/** Appends the query parameters a contract defines, dropping the empty ones. */
function appendQuery(url: string, query: Record<string, string | number | undefined>): string {
  const entries = Object.entries(query)
    .filter(([, value]) => value !== undefined && `${value}`.trim() !== '')

  if (!entries.length)
    return url

  const target = new URL(url)
  for (const [key, value] of entries)
    target.searchParams.set(key, `${value}`)

  return target.toString()
}

/**
 * Sends one request and reports what the service answered.
 *
 * This module reads only the transport: status, round-trip time and failure kind.
 * Each contract module reads the body, because one failure reported in two
 * vocabularies cannot be explained to a user.
 */
export async function requestService(input: ServiceRequestInput): Promise<ServiceResponse> {
  const timeoutMs = input.timeoutMs ?? serviceRequestTimeoutMs
  const startedAt = Date.now()

  let url: string
  try {
    url = appendQuery(normalizeServiceUrl(input.baseUrl), input.query ?? {})
  }
  catch (error) {
    return {
      ok: false,
      latencyMs: Date.now() - startedAt,
      failureKind: 'unreachable',
      errorMessage: errorMessageFrom(error),
      body: undefined,
    }
  }

  const headers: Record<string, string> = {}
  if (input.body)
    headers['Content-Type'] = 'application/json'

  // This deployment's API authorizes with the session token and adds the service
  // key on the way out. A third-party endpoint has neither, so it keeps using the
  // connection's own key.
  const deploymentApi = targetsDeploymentApi(url)
  const apiKey = deploymentApi ? '' : (input.apiKey?.trim() ?? '')
  if (apiKey) {
    if (input.credentialHeader === 'x-api-key')
      headers['X-API-Key'] = apiKey
    else
      headers.Authorization = `Bearer ${apiKey}`
  }

  try {
    const response = await (deploymentApi ? authedFetch : fetch)(url, {
      method: input.method ?? 'POST',
      headers,
      ...(input.body ? { body: JSON.stringify(input.body) } : {}),
      signal: AbortSignal.timeout(timeoutMs),
    })

    return {
      ok: response.ok,
      httpStatus: response.status,
      latencyMs: Date.now() - startedAt,
      body: await readJsonBody(response),
    }
  }
  catch (error) {
    const timedOut = error instanceof DOMException && error.name === 'TimeoutError'

    return {
      ok: false,
      latencyMs: Date.now() - startedAt,
      failureKind: timedOut ? 'timeout' : await classifyNetworkFailure(url, timeoutMs),
      errorMessage: errorMessageFrom(error),
      body: undefined,
    }
  }
}
