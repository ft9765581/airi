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

/**
 * Plans expression-system sync for one display model.
 *
 * ROOT CAUSE:
 *
 * A browser with older checkboxes and no/missing local edit time used to push
 * whenever content differed. That let Cursor re-upload stale `f01` over Chrome's
 * newer `f02`. Local blobs now carry `updatedAt`; unstamped local choices only
 * win when the account has no expression choices yet.
 */
export function planExpressionSync<T>(input: {
  localUpdatedAt: string | null
  localHasChoices: boolean
  remoteHasChoices: boolean
  contentEqual: boolean
  remote: { value: T, updatedAt: string } | null
}): FieldSyncAction<T> {
  if (input.contentEqual)
    return { type: 'none' }

  if (!input.remote)
    return input.localUpdatedAt || input.localHasChoices ? { type: 'push' } : { type: 'none' }

  const side = preferredSide(input.localUpdatedAt, input.remote.updatedAt)

  // A newer local timestamp only wins when this browser still has real
  // choices. Idle browsers mint fresh empty blobs while models remount; those
  // must apply the account copy instead of blocking sync.
  if (side === 'local') {
    if (input.localHasChoices)
      return { type: 'push' }
    if (input.remoteHasChoices)
      return { type: 'apply', value: input.remote.value, updatedAt: input.remote.updatedAt }
    return { type: 'none' }
  }

  // Unstamped local edits upload only into an empty account.
  if (input.localUpdatedAt == null && input.localHasChoices && !input.remoteHasChoices)
    return { type: 'push' }

  // Same save time with different content: only push when local still has
  // choices. An empty local browser must apply the account copy instead of
  // wiping it.
  if (timestampMillis(input.localUpdatedAt) === timestampMillis(input.remote.updatedAt)) {
    if (input.localHasChoices)
      return { type: 'push' }
    return { type: 'apply', value: input.remote.value, updatedAt: input.remote.updatedAt }
  }

  return { type: 'apply', value: input.remote.value, updatedAt: input.remote.updatedAt }
}

/**
 * Decides whether to ask before the first upload.
 *
 * An account with a settings row does not see the question. A stored choice
 * also keeps the question closed after a reload.
 */
export function shouldAskRuntimeImport(input: {
  hasSettingsRow: boolean
  storedChoice: string | null
}): boolean {
  if (input.hasSettingsRow)
    return false
  return input.storedChoice == null
}

/**
 * Decides whether this browser must copy one account value.
 *
 * A newer account value is copied. An equal save time is copied when this
 * browser does not show that value. A newer local save stays on this browser.
 */
export function shouldWriteAccountField(actionType: FieldSyncAction<unknown>['type'], localMatches: boolean): boolean {
  if (actionType === 'push')
    return false
  if (actionType === 'apply')
    return true
  return !localMatches
}
