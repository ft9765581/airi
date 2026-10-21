import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { installStaleBuildRecovery } from './stale-build-recovery'

/**
 * The module reads `window`, `sessionStorage`, `caches` and `location` straight
 * from the global scope, so each test installs a stub before it runs.
 */
function installStubs() {
  const storage = new Map<string, string>()
  const reload = vi.fn()
  const cacheDelete = vi.fn(async () => true)
  const events = new EventTarget()

  const windowStub = Object.assign(events, { location: { reload } })
  const sessionStorageStub = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  }
  const cachesStub = {
    keys: async () => ['workbox-precache-v2', 'transformers-cache-v1'],
    delete: cacheDelete,
  }

  vi.stubGlobal('window', windowStub)
  vi.stubGlobal('sessionStorage', sessionStorageStub)
  vi.stubGlobal('caches', cachesStub)

  return { windowStub, reload, cacheDelete, storage }
}

describe('stale build recovery', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('clears the cache storage and reloads once when a chunk fails to preload', async () => {
    const { windowStub, reload, cacheDelete } = installStubs()
    installStaleBuildRecovery()

    windowStub.dispatchEvent(new Event('vite:preloadError'))

    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1))
    expect(cacheDelete).toHaveBeenCalledWith('workbox-precache-v2')
    // The downloaded inference models sit in their own bucket; deleting them
    // would force a large re-download for nothing.
    expect(cacheDelete).not.toHaveBeenCalledWith('transformers-cache-v1')
  })

  it('recovers from the rejection a browser raises for a missing module', async () => {
    const { windowStub, reload } = installStubs()
    installStaleBuildRecovery()

    const event = Object.assign(new Event('unhandledrejection'), {
      reason: new TypeError('Failed to fetch dynamically imported module: /assets/sign-in-abc.js'),
    })
    windowStub.dispatchEvent(event)

    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1))
  })

  it('leaves an unrelated rejection alone', async () => {
    const { windowStub, reload } = installStubs()
    installStaleBuildRecovery()

    const event = Object.assign(new Event('unhandledrejection'), {
      reason: new Error('user aborted the request'),
    })
    windowStub.dispatchEvent(event)

    await new Promise(resolve => setTimeout(resolve, 20))
    expect(reload).not.toHaveBeenCalled()
  })

  it('does not reload again when the same failure repeats right after the reload', async () => {
    const { windowStub, reload } = installStubs()
    installStaleBuildRecovery()

    windowStub.dispatchEvent(new Event('vite:preloadError'))
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1))

    // The reload starts a fresh page, so the guard state is re-installed. A
    // broken deployment fails again immediately; a second reload would trap the
    // visitor in a loop, so the guard keeps the failure visible instead.
    installStaleBuildRecovery()
    windowStub.dispatchEvent(new Event('vite:preloadError'))
    await new Promise(resolve => setTimeout(resolve, 20))

    expect(reload).toHaveBeenCalledTimes(1)
    expect(console.error).toHaveBeenCalled()
  })
})
