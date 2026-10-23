import type { AccountSections } from './account-settings'

import { authedFetch } from './auth-fetch'
import { SERVER_URL } from './server'

export interface RuntimeCardRecord {
  cardId: string
  card: unknown
  updatedAt: string
  deletedAt: string | null
}

export interface RuntimeSettingsRecord {
  activeCardId: string
  activeCardUpdatedAt: string
  profileContent: string
  profileUpdatedAt: string
  sections: AccountSections
  deletedAt: string | null
}

export interface RuntimeProfileSnapshot {
  settings: RuntimeSettingsRecord | null
  cards: RuntimeCardRecord[]
}

export interface SaveRuntimeCardResult {
  applied: boolean
  record: RuntimeCardRecord
}

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = await response.text()
    throw new Error(body || `Request failed with ${response.status}`)
  }
  return await response.json() as T
}

function profileUrl(path: string): URL {
  return new URL(path, SERVER_URL)
}

export async function fetchRuntimeProfile(): Promise<RuntimeProfileSnapshot> {
  const response = await authedFetch(profileUrl('/api/v1/runtime-profile'))
  return await readJson(response)
}

export async function saveRuntimeSettings(input: {
  activeCardId: string
  activeCardUpdatedAt: string
  profileContent: string
  profileUpdatedAt: string
  sections?: AccountSections
}): Promise<RuntimeSettingsRecord> {
  const response = await authedFetch(profileUrl('/api/v1/runtime-profile/settings'), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  return await readJson(response)
}

export async function saveRuntimeCard(cardId: string, card: unknown, updatedAt: string): Promise<SaveRuntimeCardResult> {
  const response = await authedFetch(profileUrl(`/api/v1/runtime-profile/cards/${encodeURIComponent(cardId)}`), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ card, updatedAt }),
  })
  return await readJson(response)
}

export async function deleteRuntimeCard(cardId: string, updatedAt: string): Promise<SaveRuntimeCardResult | null> {
  const response = await authedFetch(profileUrl(`/api/v1/runtime-profile/cards/${encodeURIComponent(cardId)}`), {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ updatedAt }),
  })
  if (response.status === 204)
    return null
  return await readJson(response)
}
