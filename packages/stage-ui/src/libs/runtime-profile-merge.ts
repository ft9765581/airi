export interface RemoteRuntimeCard {
  cardId: string
  card: unknown
  updatedAt: string
  deletedAt: string | null
}

export type CardSyncAction
  = | { type: 'push' }
    | { type: 'apply', card: unknown, updatedAt: string }
    | { type: 'remove', updatedAt: string }
    | { type: 'none' }

export type FieldSyncAction<T>
  = | { type: 'push' }
    | { type: 'apply', value: T, updatedAt: string }
    | { type: 'none' }

/**
 * Parses a save timestamp. An empty or invalid value has no time.
 */
export function timestampMillis(value: string | null | undefined): number | null {
  if (!value)
    return null

  const millis = Date.parse(value)
  return Number.isFinite(millis) ? millis : null
}

/**
 * Chooses the later save. An equal timestamp keeps the remote copy.
 */
export function preferredSide(localUpdatedAt: string | null, remoteUpdatedAt: string | null): 'local' | 'remote' | 'neither' {
  const local = timestampMillis(localUpdatedAt)
  const remote = timestampMillis(remoteUpdatedAt)
  if (local == null && remote == null)
    return 'neither'
  if (local == null)
    return 'remote'
  if (remote == null)
    return 'local'
  if (local > remote)
    return 'local'
  return 'remote'
}

/**
 * Plans one card against the account copy.
 *
 * A missing local timestamp loses to any remote save. An equal timestamp
 * stays put so a completed upload does not upload again.
 */
export function planCardSync(input: {
  localExists: boolean
  localUpdatedAt: string | null
  remote: RemoteRuntimeCard | null
}): CardSyncAction {
  const remote = input.remote
  if (remote?.deletedAt) {
    if (!input.localExists)
      return { type: 'none' }

    if (preferredSide(input.localUpdatedAt, remote.deletedAt) === 'local')
      return { type: 'push' }

    return { type: 'remove', updatedAt: remote.deletedAt }
  }

  if (!remote) {
    // A card with no save time for this account stays off the account. The
    // import action uploads it explicitly. This stops another user's local
    // card from being saved into the account that just signed in.
    if (!input.localExists || !input.localUpdatedAt)
      return { type: 'none' }
    return { type: 'push' }
  }

  if (!input.localExists)
    return { type: 'apply', card: remote.card, updatedAt: remote.updatedAt }

  if (preferredSide(input.localUpdatedAt, remote.updatedAt) === 'local')
    return { type: 'push' }

  if (timestampMillis(input.localUpdatedAt) === timestampMillis(remote.updatedAt))
    return { type: 'none' }

  return { type: 'apply', card: remote.card, updatedAt: remote.updatedAt }
}

/**
 * Plans one settings field. The active card and the profile text each keep
 * their own timestamp, so a newer profile does not replace a newer card choice.
 */
export function planFieldSync<T>(input: {
  localUpdatedAt: string | null
  remote: { value: T, updatedAt: string } | null
}): FieldSyncAction<T> {
  if (!input.remote)
    return input.localUpdatedAt ? { type: 'push' } : { type: 'none' }

  if (preferredSide(input.localUpdatedAt, input.remote.updatedAt) === 'local')
    return { type: 'push' }

  if (timestampMillis(input.localUpdatedAt) === timestampMillis(input.remote.updatedAt))
    return { type: 'none' }

  return { type: 'apply', value: input.remote.value, updatedAt: input.remote.updatedAt }
}
