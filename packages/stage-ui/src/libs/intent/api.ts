import type { IntentSampleGroup } from './evaluate'

import { errorMessageFrom } from '@moeru/std'

import { authedFetch } from '../auth-fetch'
import { SERVER_URL } from '../server'

/**
 * Client for the intent evaluation resources.
 *
 * The browser holds no authority for samples or reports (intent-routing.md §9.4):
 * this module reads and writes them through `/api/v1/intent-eval`. Every call
 * goes through `authedFetch`, so an expired token is refreshed once instead of
 * surfacing as a failed save.
 */

/** One earlier turn a sample depends on. */
export interface RemoteContextMessage {
  role: 'user' | 'assistant'
  content: string
}

/** One sample as the API returns it. */
export interface RemoteIntentSample {
  id: string
  input: string
  /** Earlier turns in order, when the sample needs context. */
  context?: RemoteContextMessage[] | null
  group: IntentSampleGroup
  /** Missing while the sample is still unlabelled: a run skips it. */
  expected?: 'medical' | 'chat'
  labelStatus: 'unreviewed' | 'reviewed'
  source: string | null
  sampleSetVersion: number
  createdAt: string
  updatedAt: string
}

/** One sample as a client may create it. */
export interface RemoteIntentSampleInput {
  input: string
  /** Earlier turns in order; an assistant turn changes what the next one means. */
  context?: RemoteContextMessage[]
  group: IntentSampleGroup
  /** Missing while the sample is still unlabelled: a run skips it. */
  expected?: 'medical' | 'chat'
  labelStatus?: 'unreviewed' | 'reviewed'
  source?: string
  sampleSetVersion?: number
}

/** One method's numbers, as the run stores them. */
export interface RemoteRunMetrics {
  rules?: { recall?: number, falsePositive?: number, failure?: number, uncertain?: number, medicalTotal?: number, chatTotal?: number }
  model?: { recall?: number, falsePositive?: number, failure?: number, uncertain?: number, medicalTotal?: number, chatTotal?: number }
}

/** One sample's verdicts inside a run. */
export interface RemoteRunCase {
  sampleId: string
  input: string
  /** Earlier turns in order; an assistant turn changes what the next one means. */
  context?: RemoteContextMessage[]
  expected?: 'medical' | 'chat'
  rules?: string
  model?: string
  disagreement?: boolean
}

/** One run as the API returns it. */
export interface RemoteIntentRun {
  id: string
  sampleSetVersion: number
  /** The collection this run read, when it read one. */
  collectionId?: string
  /** development on the bench, cceptance for the release gate. */
  purpose?: 'development' | 'acceptance'
  mode: 'rules' | 'model' | 'compare'
  status: 'running' | 'completed' | 'failed' | 'cancelled'
  configKey: string
  modelId: string | null
  classifierPromptDigest: string | null
  total: number
  completed: number
  metrics: RemoteRunMetrics | null
  cases: RemoteRunCase[] | null
  failureReason: string | null
  startedAt: string
  finishedAt: string | null
}

export interface RemoteIntentRunInput {
  sampleSetVersion: number
  mode: RemoteIntentRun['mode']
  configKey: string
  modelId?: string
  classifierPromptDigest?: string
  collectionId?: string
  purpose?: 'development' | 'acceptance'
  total: number
}

export interface RemoteIntentRunPatch {
  status?: RemoteIntentRun['status']
  completed?: number
  metrics?: RemoteRunMetrics
  cases?: RemoteRunCase[]
  failureReason?: string
}

/** Where a collection sits in the evaluation plan. Grants no permission. */
export type RemoteIntentCollectionPurpose = 'development' | 'acceptance'

/** One named sample collection, as the API returns it. */
export interface RemoteIntentCollection {
  id: string
  name: string
  purpose: RemoteIntentCollectionPurpose
  createdAt: string
  updatedAt: string
}

/** One collection as a page may create or rename it. */
export interface RemoteIntentCollectionInput {
  name: string
  purpose?: RemoteIntentCollectionPurpose
}

const endpoint = () => `${SERVER_URL.replace(/\/+$/, '')}/api/v1/intent-eval`

/**
 * One request, with the API's error shape turned into a message.
 *
 * The route answers `{ error, message }`; returning the bare status would make
 * every failure read the same in the page.
 */
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await authedFetch(`${endpoint()}${path}`, init)

  if (!response.ok) {
    const body = await response.json().catch(() => undefined) as { message?: string, error?: string } | undefined
    const detail = body?.message ?? body?.error ?? `${response.status} ${response.statusText}`
    throw new Error(detail)
  }

  if (response.status === 204)
    return undefined as T

  return await response.json() as T
}

function jsonRequest(body: unknown, method = 'POST'): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
}

export const intentEvalApi = {
  listSamples: (collectionId?: string) => request<RemoteIntentSample[]>(collectionId
    ? `/samples?collectionId=${encodeURIComponent(collectionId)}`
    : '/samples'),

  listCollections: () => request<RemoteIntentCollection[]>('/collections'),

  createCollection: (input: RemoteIntentCollectionInput) =>
    request<RemoteIntentCollection>('/collections', jsonRequest(input)),

  updateCollection: (id: string, patch: Partial<RemoteIntentCollectionInput>) =>
    request<RemoteIntentCollection>(`/collections/${encodeURIComponent(id)}`, jsonRequest(patch, 'PATCH')),

  deleteCollection: (id: string) =>
    request<void>(`/collections/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  importSamples: (samples: RemoteIntentSampleInput[]) =>
    request<RemoteIntentSample[]>('/samples/import', jsonRequest({ samples })),

  updateSample: (id: string, patch: Partial<RemoteIntentSampleInput>) =>
    request<RemoteIntentSample>(`/samples/${encodeURIComponent(id)}`, jsonRequest(patch, 'PATCH')),

  deleteSample: (id: string) =>
    request<void>(`/samples/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  listRuns: (limit = 20) => request<RemoteIntentRun[]>(`/runs?limit=${limit}`),

  createRun: (input: RemoteIntentRunInput) =>
    request<RemoteIntentRun>('/runs', jsonRequest(input)),

  updateRun: (id: string, patch: RemoteIntentRunPatch) =>
    request<RemoteIntentRun>(`/runs/${encodeURIComponent(id)}`, jsonRequest(patch, 'PATCH')),
}

/** Reads a message out of a failed call, for a page that only shows text. */
export function describeIntentEvalError(error: unknown): string {
  return errorMessageFrom(error) ?? '请求失败'
}
