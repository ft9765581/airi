/**
 * Reloads the tab when a lazily imported chunk from an older deployment is gone.
 *
 * Every deploy replaces the hashed assets. A browser that still runs the previous
 * bundle keeps asking for the old chunk names, and that import rejects with
 * "Failed to fetch dynamically imported module" (Chrome, Firefox) or
 * "Importing a module script failed" (Safari). The user sees a blank view or a
 * spinner that never finishes, and nothing in the UI leads out of it.
 *
 * Vite reports the case as a `vite:preloadError` event on `window`. This module
 * drops the caches that may still hold the old HTML and reloads once, so the new
 * entry document loads the new chunks. The reload is recorded in `sessionStorage`
 * so a deployment that is broken outright cannot turn into a reload loop.
 */

import { errorMessageFrom } from '@moeru/std'

/** Session key holding the timestamp of the last automatic reload. */
const RELOAD_AT_KEY = 'settings/stale-build-reload-at'

/** A second failure inside this window is treated as a broken deployment. */
const RELOAD_WINDOW_MS = 30_000

/** Matches the messages the browsers use when a chunk no longer exists. */
const MISSING_CHUNK_PATTERN = /dynamically imported module|Importing a module script failed|Failed to fetch/i

function readLastReloadAt(): number {
  try {
    return Number.parseInt(sessionStorage.getItem(RELOAD_AT_KEY) ?? '', 10) || 0
  }
  catch {
    // Storage access throws when the browser blocks it. A failed read only costs
    // the loop guard, so recovery still runs.
    return 0
  }
}

function markReload(): void {
  try {
    sessionStorage.setItem(RELOAD_AT_KEY, Date.now().toString())
  }
  catch {}
}

/**
 * Prefix of the Cache Storage buckets that the service worker owns.
 *
 * Only these are deleted. `packages/stage-ui/src/libs/inference/cache-utils.ts`
 * keeps the downloaded inference models in their own bucket, and deleting that
 * would make the visitor download those models again.
 */
const WORKBOX_CACHE_PREFIX = 'workbox-'

/**
 * Deletes the service worker caches that this origin holds.
 *
 * These buckets can answer a navigation with the previous `index.html`, which is
 * what keeps the browser on the old bundle after a deploy. `localStorage`,
 * `IndexedDB`, cookies and the inference model cache are left alone: they hold
 * the visitor's settings, chat history and downloaded models, and no reload needs
 * to replace them.
 */
async function clearServiceWorkerCaches(): Promise<void> {
  if (typeof caches === 'undefined')
    return

  try {
    const keys = await caches.keys()
    await Promise.all(
      keys
        .filter(key => key.startsWith(WORKBOX_CACHE_PREFIX))
        .map(key => caches.delete(key)),
    )
  }
  catch {
    // A blocked deletion must not keep the page on the broken bundle.
  }
}

function isMissingChunkError(reason: unknown): boolean {
  if (!reason)
    return false

  // `errorMessageFrom` answers `undefined` for a value it cannot describe.
  const message = errorMessageFrom(reason) ?? ''
  // A network outage also says "Failed to fetch". The pattern only matches the
  // browser's module-loading wording, so an offline visitor keeps the page.
  return MISSING_CHUNK_PATTERN.test(message) && /module/i.test(message)
}

/**
 * Installs the recovery listeners. Call once, before the app mounts.
 *
 * @example
 * installStaleBuildRecovery()
 */
export function installStaleBuildRecovery(): void {
  if (typeof window === 'undefined')
    return

  let recovering = false

  function recover(): void {
    if (recovering)
      return
    if (Date.now() - readLastReloadAt() < RELOAD_WINDOW_MS) {
      // The reload did not help, so the deployment itself is broken. Stop here
      // and leave the failure visible instead of reloading forever.
      console.error('[stale-build] a chunk is still missing after a reload; check the deployment')
      return
    }

    recovering = true
    markReload()
    void clearServiceWorkerCaches().finally(() => window.location.reload())
  }

  window.addEventListener('vite:preloadError', (event) => {
    event.preventDefault()
    recover()
  })

  window.addEventListener('unhandledrejection', (event) => {
    if (isMissingChunkError(event.reason))
      recover()
  })
}
