import type { ServiceResponse } from './external-service'

import {
  readBodyArray,
  readBodyNumber,
  readBodyString,
  requestService,
} from './external-service'

/**
 * The knowledge graph search contract of this deployment.
 *
 * The service answers with relations (triples), not with document passages:
 * `源实体 —关系→ 目标实体`, each with the source text the relation came from.
 * Passage retrieval is a different endpoint (`POST /api/dify/retrieval`, the
 * knowledge base contract in `./knowledge-base`).
 *
 * The published contract is `GET {base}/api/graph/search?q=…&limit=…&book_id=…`
 * on `knowledge.bestmings.com`. It searches published graphs only, and the
 * deployment currently answers in `lexical` mode, so a query must match words the
 * graph already holds.
 */

/**
 * The query the connection test sends.
 *
 * The search is lexical, so the probe word must be a term a medical graph holds.
 * The published example query is used, because a made-up word such as
 * `连接测试` matches nothing and would tell a user nothing about the connection.
 */
export const knowledgeGraphProbeQuery = '发热'

/** How many relations the settings probe asks for. */
export const knowledgeGraphProbeLimit = 5

/** One relation a graph search returned. */
export interface KnowledgeGraphRelation {
  /** The entity the relation starts from. */
  sourceTitle: string
  /** The relation kind, such as `HAS_SYMPTOM` or `DERIVED_FROM`. */
  relationType: string
  /** The entity the relation points to. */
  targetTitle: string
  /**
   * The source text the relation came from.
   *
   * The service calls this the key to judging a relation, so it is kept even
   * though the settings page shows only counts.
   */
  evidence: string
  /** The relation weight the service reports. @default 1.0 */
  weight?: number
}

/** The outcome of one graph search. */
export interface KnowledgeGraphResponse extends Omit<ServiceResponse, 'body'> {
  /** The relations the service returned, in service order. */
  relations: KnowledgeGraphRelation[]
  /**
   * The relation count the service reported.
   *
   * The service caps this at the `limit` of the request, so it counts the rows of
   * this answer and not every hit in the graph.
   */
  total: number
  /** The search mode the service used: `lexical` or `hybrid`. */
  mode?: string
  /** Why the service fell back to lexical search, when it did. */
  fallbackReason?: string
}

/** The values one graph search needs. */
export interface KnowledgeGraphRequestInput {
  /** The search endpoint address. */
  baseUrl: string
  /** The credential for the endpoint, sent as `X-API-Key`. */
  apiKey?: string
  /**
   * Limits the search to one document.
   *
   * The service takes a `Book.id` here, not a knowledge base id. Empty searches
   * every published graph.
   */
  bookId?: string
  /** The text to search for. The service accepts 1 to 2000 characters. */
  query: string
  /**
   * The maximum relations the service returns.
   *
   * Omitted sends no `limit`, so the service applies the 8 it documents.
   */
  limit?: number
  /** How long the request can run. @default serviceRequestTimeoutMs */
  timeoutMs?: number
}

function readRelations(body: unknown): KnowledgeGraphRelation[] {
  const relations: KnowledgeGraphRelation[] = []

  for (const entry of readBodyArray(body, 'results')) {
    const relationType = readBodyString(entry, 'relation_type')
    const sourceTitle = readBodyString(entry, 'source_title')
    const targetTitle = readBodyString(entry, 'target_title')
    if (!relationType || !sourceTitle || !targetTitle)
      continue

    relations.push({
      sourceTitle,
      relationType,
      targetTitle,
      evidence: readBodyString(entry, 'evidence') ?? '',
      weight: readBodyNumber(entry, 'weight'),
    })
  }

  return relations
}

/**
 * Sends one graph search and reports what the service answered.
 *
 * The endpoint reports a failure with an HTTP status, unlike the retrieval
 * endpoint, which answers HTTP 200 with an `error_code`. A 404 means the graph
 * service is not mounted at that address; the page explains the status, so this
 * function does not translate it.
 */
export async function requestKnowledgeGraphSearch(
  input: KnowledgeGraphRequestInput,
): Promise<KnowledgeGraphResponse> {
  const response = await requestService({
    baseUrl: input.baseUrl,
    method: 'GET',
    query: {
      q: input.query,
      // Omitted when the caller sets no limit, so the service applies the default
      // it documents instead of this client inventing a second one.
      limit: input.limit,
      book_id: input.bookId?.trim(),
    },
    apiKey: input.apiKey,
    credentialHeader: 'x-api-key',
    timeoutMs: input.timeoutMs,
  })

  return {
    ok: response.ok,
    httpStatus: response.httpStatus,
    latencyMs: response.latencyMs,
    failureKind: response.failureKind,
    errorMessage: response.errorMessage,
    relations: readRelations(response.body),
    // The service reports the same number here as it returns in `results`, capped
    // by `limit`, so this is the size of the answer and not the graph's hit count.
    total: readBodyNumber(response.body, 'total') ?? 0,
    mode: readBodyString(response.body, 'mode'),
    fallbackReason: readBodyString(response.body, 'fallback_reason'),
  }
}
