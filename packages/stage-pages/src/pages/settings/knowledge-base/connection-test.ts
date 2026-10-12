import { errorMessageFrom } from '@moeru/std'

/** How long one test request can run before AIRI stops it. */
const TEST_TIMEOUT_MS = 8000

/**
 * The query the test sends.
 *
 * The service must answer the request, and the answer must follow the retrieval
 * contract. A short Chinese probe works for the knowledge bases AIRI targets.
 * A hit count of zero is a valid answer.
 */
const PROBE_QUERY = '连接测试'

/** The Dify external knowledge error codes that name the failure. */
const DIFY_ERROR_AUTHORIZATION_FORMAT = 1001
const DIFY_ERROR_AUTHENTICATION = 1002
const DIFY_ERROR_KNOWLEDGE_BASE_MISSING = 2001

/**
 * The raw result of one test request.
 *
 * The message a user reads is built from these fields, so this module stays
 * free of user-facing text.
 */
export interface ConnectionTestResult {
  /** True only when the service answered with a success status. */
  ok: boolean
  /** The status the service returned, when it answered. */
  httpStatus?: number
  /** Round-trip time in milliseconds. */
  latencyMs: number
  /** True when the request ran past the timeout. */
  timedOut: boolean
  /** The runtime error message, when the request did not complete. */
  errorMessage?: string
  /** How many records the probe query returned. */
  recordCount?: number
  /** The error code the service body carried. */
  serviceErrorCode?: number
  /** The error message the service body carried. */
  serviceErrorMessage?: string
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

function readRecordCount(body: unknown): number | undefined {
  const records = readRecord(body, 'records')
  return Array.isArray(records) ? records.length : undefined
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
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
 * Sends one retrieval request and reports what the service answered.
 *
 * The request follows the Dify external knowledge contract, because that is the
 * contract the services AIRI targets expose. The body carries the knowledge id
 * from the form, one probe query, and a `top_k` of one. The service validates
 * the body before it checks the key, so a wrong body shape shows up as HTTP 422
 * and a wrong key shows up as HTTP 401 or 403.
 *
 * A browser blocks the request when the service origin allowlist excludes the
 * AIRI page origin. The caller cannot tell that case apart from a network
 * failure, because the browser reports both as one fetch rejection.
 */
export async function testKnowledgeBaseConnection(input: {
  baseUrl: string
  apiKey?: string
  knowledgeId?: string
}): Promise<ConnectionTestResult> {
  const url = normalizeKnowledgeBaseUrl(input.baseUrl)
  const startedAt = Date.now()

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(input.apiKey?.trim() ? { Authorization: `Bearer ${input.apiKey.trim()}` } : {}),
      },
      body: JSON.stringify({
        knowledge_id: input.knowledgeId?.trim() ?? '',
        query: PROBE_QUERY,
        retrieval_setting: {
          top_k: 1,
          score_threshold: 0,
        },
      }),
      signal: AbortSignal.timeout(TEST_TIMEOUT_MS),
    })

    const body = await readJsonBody(response)
    const serviceErrorCode = readNumber(readRecord(body, 'error_code'))

    return {
      // The service reports a business error with HTTP 200 and an error code in
      // the body, so the status code alone does not prove that the connection
      // works. A missing knowledge base answers this way.
      ok: response.ok && serviceErrorCode === undefined,
      httpStatus: response.status,
      latencyMs: Date.now() - startedAt,
      timedOut: false,
      recordCount: readRecordCount(body),
      serviceErrorCode,
      serviceErrorMessage: readString(readRecord(body, 'error_msg')),
    }
  }
  catch (error) {
    return {
      ok: false,
      latencyMs: Date.now() - startedAt,
      timedOut: error instanceof DOMException && error.name === 'TimeoutError',
      errorMessage: errorMessageFrom(error),
    }
  }
}

/**
 * The Dify error codes the test result message explains.
 *
 * The page names the cause of each code, so a user learns which field to check.
 */
export const difyErrorCodes = {
  authorizationFormat: DIFY_ERROR_AUTHORIZATION_FORMAT,
  authentication: DIFY_ERROR_AUTHENTICATION,
  knowledgeBaseMissing: DIFY_ERROR_KNOWLEDGE_BASE_MISSING,
} as const

/** The timeout in seconds, for a message a user reads. */
export const connectionTestTimeoutSeconds = TEST_TIMEOUT_MS / 1000
