import { errorMessageFrom } from '@moeru/std'

/** How long one test request can run before AIRI stops it. */
const TEST_TIMEOUT_MS = 8000

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
}

/**
 * Adds a scheme when the user typed a bare host.
 *
 * A fetch call needs a scheme, and users often paste only the host. A bare host
 * becomes HTTPS. An address that already has a scheme stays as typed.
 *
 * @example
 * normalizeKnowledgeBaseUrl('kb.example.com/v1')
 * // => 'https://kb.example.com/v1'
 * @example
 * normalizeKnowledgeBaseUrl('http://localhost:8080')
 * // => 'http://localhost:8080'
 */
export function normalizeKnowledgeBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim()
  if (!trimmed)
    return ''

  if (/^https?:\/\//i.test(trimmed))
    return trimmed

  return `https://${trimmed}`
}

/**
 * Sends one request to the knowledge base address and reports what happened.
 *
 * The test checks reachability and credentials only. It does not check the
 * service API contract, because AIRI has no adapter for that service yet. A
 * `GET` on the base address answers on most services, and any HTTP status
 * proves that the host is reachable.
 *
 * A browser blocks the request when the service sends no CORS headers. The
 * caller cannot tell that case apart from a network failure, because the
 * browser reports both as one fetch rejection.
 */
export async function testKnowledgeBaseConnection(input: {
  baseUrl: string
  apiKey?: string
}): Promise<ConnectionTestResult> {
  const url = normalizeKnowledgeBaseUrl(input.baseUrl)
  const startedAt = Date.now()

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: input.apiKey?.trim()
        ? { Authorization: `Bearer ${input.apiKey.trim()}` }
        : undefined,
      signal: AbortSignal.timeout(TEST_TIMEOUT_MS),
    })

    return {
      ok: response.ok,
      httpStatus: response.status,
      latencyMs: Date.now() - startedAt,
      timedOut: false,
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

/** The timeout in seconds, for a message a user reads. */
export const connectionTestTimeoutSeconds = TEST_TIMEOUT_MS / 1000
