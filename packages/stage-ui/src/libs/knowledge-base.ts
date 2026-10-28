import type { ServiceResponse } from './external-service'

import {
  readBodyField,
  readBodyNumber,
  readBodyString,
  requestService,
} from './external-service'

/**
 * The knowledge base retrieval contract.
 *
 * One module owns the request shape, because two callers use it: the settings
 * page tests a connection, and the chat runtime retrieves records for a send.
 * The service follows the Dify external knowledge contract. See `docs` in the
 * knowledge base backend for the service side.
 */

/**
 * The query the connection test sends.
 *
 * The service must answer the request and the answer must follow the contract.
 * A hit count of zero is a valid answer, because the knowledge base can be
 * empty.
 */
export const knowledgeBaseProbeQuery = '连接测试'

/** One record a retrieval returned. */
export interface KnowledgeBaseRecord {
  /** The text the knowledge base holds. */
  content: string
  /** The similarity the service computed. */
  score?: number
  /** The title of the source document, when the service sends one. */
  title?: string
}

/** The outcome of one retrieval request. */
export interface KnowledgeBaseResponse extends Omit<ServiceResponse, 'body'> {
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
  /** How long the request can run. @default serviceRequestTimeoutMs */
  timeoutMs?: number
}

function readRecords(body: unknown): KnowledgeBaseRecord[] {
  const records = readBodyField(body, 'records')
  if (!Array.isArray(records))
    return []

  const parsed: KnowledgeBaseRecord[] = []
  for (const entry of records) {
    const content = readBodyString(entry, 'content')
    if (!content)
      continue

    parsed.push({
      content,
      score: readBodyNumber(entry, 'score'),
      title: readBodyString(entry, 'title'),
    })
  }

  return parsed
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
  const response = await requestService({
    baseUrl: input.baseUrl,
    apiKey: input.apiKey,
    body: {
      knowledge_id: input.knowledgeBaseId.trim(),
      query: input.query,
      retrieval_setting: {
        top_k: input.topK ?? 5,
        score_threshold: input.scoreThreshold ?? 0,
      },
    },
    timeoutMs: input.timeoutMs,
  })

  const serviceErrorCode = readBodyNumber(response.body, 'error_code')

  return {
    ok: response.ok && serviceErrorCode === undefined,
    httpStatus: response.httpStatus,
    latencyMs: response.latencyMs,
    failureKind: response.failureKind,
    errorMessage: response.errorMessage,
    records: readRecords(response.body),
    serviceErrorCode,
    serviceErrorMessage: readBodyString(response.body, 'error_msg'),
  }
}
