import type { MemoryCategory, MemoryFactDraft } from './memory-facts'

import { authedFetch } from './auth-fetch'
import { SERVER_URL } from './server'

export interface MemoryHit {
  id: string
  characterId: string
  scope: 'user' | 'character'
  category: MemoryCategory | null
  content: string
  importance: number
  createdAt: string
}

export interface MemoryRollupResult {
  profileContent: string
  profileUpdatedAt: string
  rolledCount: number
  appliedIds: string[]
}

export interface StoredMemory extends MemoryHit {
  recallCount: number
  lastRecalledAt: string | null
  updatedAt: string
}

function memoriesUrl(path = '/api/v1/memories'): URL {
  return new URL(path, SERVER_URL)
}

/**
 * Loads a few stored facts that match the current message.
 *
 * The caller skips this when the person is signed out. A failed response
 * throws so the chat context provider can continue without memory.
 */
export async function searchMemories(query: string, characterId: string, signal?: AbortSignal): Promise<MemoryHit[]> {
  const url = memoriesUrl()
  url.searchParams.set('query', query)
  url.searchParams.set('characterId', characterId)
  url.searchParams.set('timeZone', Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC')

  const response = await authedFetch(url, { signal })
  if (!response.ok)
    throw new Error(`Memory search failed with ${response.status}`)

  const body = await response.json() as { memories?: MemoryHit[] }
  return Array.isArray(body.memories) ? body.memories : []
}

/**
 * Stores facts from one finished chat turn.
 *
 * The server keeps a repeated fact once. The caller ignores the response
 * body and must not fail the chat when this request fails.
 */
/** Loads the active facts for the signed-in account, newest edit first. */
export async function listMemories(): Promise<StoredMemory[]> {
  const response = await authedFetch(memoriesUrl('/api/v1/memories/items'))
  if (!response.ok)
    throw new Error(`Memory list failed with ${response.status}`)

  const body = await response.json() as { memories?: StoredMemory[] }
  return Array.isArray(body.memories) ? body.memories : []
}

/**
 * Marks one fact deleted for the signed-in account.
 *
 * A missing fact throws. The caller shows that error and keeps the other facts.
 */
export async function deleteMemory(memoryId: string): Promise<void> {
  const response = await authedFetch(memoriesUrl(`/api/v1/memories/${encodeURIComponent(memoryId)}`), {
    method: 'DELETE',
  })
  if (!response.ok)
    throw new Error(`Memory delete failed with ${response.status}`)
}

export async function createMemory(input: { content: string, category: MemoryCategory }): Promise<void> {
  const response = await authedFetch(memoriesUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      characterId: 'default',
      items: [{
        scope: 'user',
        content: input.content,
        importance: 8,
        category: input.category,
      }],
    }),
  })
  if (!response.ok)
    throw new Error(`Memory create failed with ${response.status}`)
}

export async function updateMemory(memoryId: string, input: { content: string, category?: MemoryCategory }): Promise<StoredMemory> {
  const response = await authedFetch(memoriesUrl(`/api/v1/memories/${encodeURIComponent(memoryId)}`), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!response.ok)
    throw new Error(`Memory update failed with ${response.status}`)

  const body = await response.json() as { memory?: StoredMemory }
  if (!body.memory)
    throw new Error('Memory update failed')
  return body.memory
}

export async function rollupMemories(input: {
  timeZone: string
  profileContent: string
  profileUpdatedAt: string
  replayIds: readonly string[]
}): Promise<MemoryRollupResult> {
  const response = await authedFetch(memoriesUrl('/api/v1/memories/rollup'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!response.ok)
    throw new Error(`Memory rollup failed with ${response.status}`)

  return await response.json() as MemoryRollupResult
}

export async function saveMemories(characterId: string, items: readonly MemoryFactDraft[]): Promise<void> {
  const response = await authedFetch(memoriesUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ characterId, items }),
  })
  if (!response.ok)
    throw new Error(`Memory save failed with ${response.status}`)
}
