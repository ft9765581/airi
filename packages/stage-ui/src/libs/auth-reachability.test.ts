import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { assertAuthServerReachable } from './auth'

describe('assertAuthServerReachable', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('resolves when the auth service answers ok', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('{"ok":true}', { status: 200 }))

    await expect(assertAuthServerReachable()).resolves.toBeUndefined()
  })

  it('rejects when the auth service is unreachable', async () => {
    vi.mocked(fetch).mockRejectedValue(new TypeError('Failed to fetch'))

    await expect(assertAuthServerReachable()).rejects.toThrow(/unreachable/i)
  })

  it('rejects when the auth service returns an error status', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('down', { status: 502 }))

    await expect(assertAuthServerReachable()).rejects.toThrow(/502/)
  })
})
