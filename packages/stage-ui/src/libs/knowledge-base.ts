import { errorMessageFrom } from '@moeru/std'

import { authedFetch } from './auth-fetch'
import { SERVER_URL } from './server'

/**
 * The knowledge base retrieval contract.
 *
 * One module owns the request shape, because two callers use it: the settings
 * page tests a connection, and the chat runtime retrieves records for a send.
 * The service follows the Dify external knowledge contract. See
 * `docs` in the knowledge base backend for the service side.
 */

/** How long one retrieval request can run before AIRI stops it. */
export const knowledgeBaseRequestTimeoutMs = 8000

/**
 * The query the connection test sends.
 *
 * The service must answer the request and the answer must follow the contract.
 * A hit count of zero is a valid answer, because the knowledge base can be
 * empty.
 */
export const knowledgeBaseProbeQuery = '连接测试'

/**
 * The service error codes the page explains.
 *
 * The service reports these codes with HTTP 200, so a caller must read the body
 * to learn that the call failed.
 */
export const knowledgeBaseErrorCodes = {
  authorizationFormat: 1001,
  authentication: 1002,
  knowledgeBaseMissing: 2001,
} as const

/** One record a retrieval returned. */
export interface KnowledgeBaseRecord {
  /** The text the knowledge base holds. */
  content: string
  /** The similarity the service computed. */
  score?: number
  /** The title of the source document, when the service sends one. */
  title?: string
}

/** Why a request did not complete. */
export type KnowledgeBaseFailureKind = 'blocked-origin' | 'unreachable' | 'timeout'

/** The outcome of one retrieval request. */
export interface KnowledgeBaseResponse {
  /** True only when the service answered with a success status and no error code. */
  ok: boolean
  /** The status the service returned, when it answered. */
  httpStatus?: number
  /** Round-trip time in milliseconds. */
  latencyMs: number
  /** Why the request did not complete, when it did not complete. */
  failureKind?: KnowledgeBaseFailureKind
  /** The runtime error message, for diagnostics. */
  errorMessage?: string
  /** The records the service returned, in service order. */
  records: KnowledgeBaseRecord[]
  /** The error code the service body carried. */
  serviceErrorCode?: number
  /** The error message the service body carried. */
  serviceErrorMessage?: string
}

/** The values one retrieval request needs. */
export interface KnowledgeBaseRequestInput {
  /** The retrieval endpoint address. */
  baseUrl: string
  /** The credential for the endpoint. */
  apiKey?: string
  /** The `knowledge_id` the endpoint expects. */
  knowledgeBaseId: string
  /** The question to search for. */
  query: string
  /** The maximum records the service returns. @default 5 */
  topK?: number
  /** The minimum similarity the service accepts. @default 0 */
  scoreThreshold?: number
  /** How long the request can run. @default knowledgeBaseRequestTimeoutMs */
  timeoutMs?: number
}

/**
 * Adds a scheme when the user typed a bare host.
 *
 * A fetch call needs a scheme, and users often paste only the host. A bare host
 * becomes HTTPS. An address that already has a scheme stays as typed.
 *
 * @example
 * normalizeKnowledgeBaseUrl('kb.example.com/api/dify/retrieval')
 * // => 'https://kb.example.com/api/dify/retrieval'
 * @example
 * normalizeKnowledgeBaseUrl('http://localhost:8090/retrieval')
 * // => 'http://localhost:8090/retrieval'
 */
export function normalizeKnowledgeBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim()
  if (!trimmed)
    return ''

  if (/^https?:\/\//i.test(trimmed))
    return trimmed

  return `https://${trimmed}`
}

function readRecord(value: unknown, key: string): unknown {
  if (typeof value !== 'object' || value === null)
    return undefined

  return (value as Record<string, unknown>)[key]
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function readRecords(body: unknown): KnowledgeBaseRecord[] {
  const records = readRecord(body, 'records')
  if (!Array.isArray(records))
    return []

  const parsed: KnowledgeBaseRecord[] = []
  for (const entry of records) {
    const content = readString(readRecord(entry, 'content'))
    if (!content)
      continue

    parsed.push({
      content,
      score: readNumber(readRecord(entry, 'score')),
      title: readString(readRecord(entry, 'title')),
    })
  }

  return parsed
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
 * therefore proves that the host answered, and only the cross-origin rule
 * stopped the first request.
 *
 * The probe uses `text/plain`, because `no-cors` permits only simple content
 * types. The service answers that request with an error, which is not read.
 */
async function classifyNetworkFailure(url: string, timeoutMs: number): Promise<KnowledgeBaseFailureKind> {
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
 * The API's retrieval route requires the session token and holds the knowledge
 * base key itself, so a request to it must carry the token. Any other endpoint
 * is a third-party service and gets the connection's own key instead.
 *
 * @example
 * targetsDeploymentApi('http://localhost:6112/api/v1/knowledge-base/retrieval')
 * // => true
 */
function targetsDeploymentApi(url: string): boolean {
  try {
    return new URL(url).origin === new URL(SERVER_URL).origin
  }
  catch {
    return false
  }
}

/**
 * Sends one retrieval request and reports what the service answered.
 *
 * The request follows the Dify external knowledge contract, because that is the
 * contract the services AIRI targets expose. The service validates the body
 * before it checks the key, so a wrong body shape shows up as HTTP 422 and a
 * wrong key shows up as HTTP 401 or 403. A missing knowledge base shows up as
 * HTTP 200 with error code 2001, which is why `ok` also reads the body.
 */
export async function requestKnowledgeBaseRetrieval(
  input: KnowledgeBaseRequestInput,
): Promise<KnowledgeBaseResponse> {
  const url = normalizeKnowledgeBaseUrl(input.baseUrl)
  const timeoutMs = input.timeoutMs ?? knowledgeBaseRequestTimeoutMs
  const startedAt = Date.now()

  // This deployment's API authorizes with the session token and adds the
  // knowledge base key on the way out. A third-party endpoint has neither, so it
  // keeps using the connection's own key.
  const send = targetsDeploymentApi(url) ? authedFetch : fetch

  try {
    const response = await send(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(input.apiKey?.trim() ? { Authorization: `Bearer ${input.apiKey.trim()}` } : {}),
      },
      body: JSON.stringify({
        knowledge_id: input.knowledgeBaseId.trim(),
        query: input.query,
        retrieval_setting: {
          top_k: input.topK ?? 5,
          score_threshold: input.scoreThreshold ?? 0,
        },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    })

    const body = await readJsonBody(response)
    const serviceErrorCode = readNumber(readRecord(body, 'error_code'))

    return {
      ok: response.ok && serviceErrorCode === undefined,
      httpStatus: response.status,
      latencyMs: Date.now() - startedAt,
      records: readRecords(body),
      serviceErrorCode,
      serviceErrorMessage: readString(readRecord(body, 'error_msg')),
    }
  }
  catch (error) {
    const timedOut = error instanceof DOMException && error.name === 'TimeoutError'

    return {
      ok: false,
      latencyMs: Date.now() - startedAt,
      failureKind: timedOut ? 'timeout' : await classifyNetworkFailure(url, timeoutMs),
      errorMessage: errorMessageFrom(error),
      records: [],
    }
  }
}
