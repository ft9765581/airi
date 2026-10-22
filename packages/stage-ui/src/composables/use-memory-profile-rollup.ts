import { errorMessageFrom } from '@moeru/std'
import { onScopeDispose, watch } from 'vue'

import { rollupMemories } from '../libs/memory-api'
import { useAuthStore } from '../stores/auth'

const RETRY_MS = 30_000
const EPOCH = '1970-01-01T00:00:00.000Z'

export interface MemoryProfileBridge {
  readProfile: () => { content: string, updatedAt: string | null }
  applyProfile: (content: string, updatedAt: string) => void
}

/**
 * Milliseconds until the next local midnight.
 *
 * The timer uses the device clock. The server then folds facts with the
 * device time zone, so a closed app catches up the next time it opens.
 */
export function millisecondsUntilNextLocalMidnight(now = new Date()): number {
  const next = new Date(now.getTime())
  next.setHours(24, 0, 0, 0)
  return Math.max(1_000, next.getTime() - now.getTime())
}

function isEditingText(): boolean {
  const element = document.activeElement
  if (!(element instanceof HTMLElement))
    return false
  if (element.isContentEditable)
    return true
  return element.tagName === 'INPUT' || element.tagName === 'TEXTAREA'
}

/**
 * Folds earlier days of memory into the user profile.
 *
 * The call runs when the app opens, when the tab becomes visible, and at the
 * next local midnight. A focused text field waits, so a half-typed profile
 * line is not replaced mid-edit.
 */
export function useMemoryProfileRollup(bridge: MemoryProfileBridge) {
  const auth = useAuthStore()
  let timer: ReturnType<typeof setTimeout> | undefined
  let running = false
  let started = false

  function schedule(delayMs: number) {
    if (timer)
      clearTimeout(timer)
    timer = setTimeout(() => {
      void run()
    }, delayMs)
  }

  async function run() {
    if (running)
      return
    if (auth.userId === 'local') {
      schedule(millisecondsUntilNextLocalMidnight())
      return
    }
    if (isEditingText()) {
      schedule(RETRY_MS)
      return
    }

    running = true
    let delay = millisecondsUntilNextLocalMidnight()
    try {
      let replayIds: string[] = []
      let last: Awaited<ReturnType<typeof rollupMemories>> | null = null
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const profile = bridge.readProfile()
        const sent = profile.content
        const result = await rollupMemories({
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
          profileContent: sent,
          profileUpdatedAt: profile.updatedAt ?? EPOCH,
          replayIds,
        })
        last = result
        if (result.rolledCount === 0)
          return

        const latest = bridge.readProfile()
        if (latest.content === sent) {
          bridge.applyProfile(result.profileContent, result.profileUpdatedAt)
          return
        }
        replayIds = result.appliedIds
      }
      if (last && last.rolledCount > 0)
        bridge.applyProfile(last.profileContent, last.profileUpdatedAt)
    }
    catch (error) {
      delay = RETRY_MS
      if (import.meta.env.DEV)
        console.warn('[long-term-memory] profile rollup failed', errorMessageFrom(error))
    }
    finally {
      running = false
      schedule(delay)
    }
  }

  function onVisible() {
    if (document.visibilityState === 'visible')
      void run()
  }

  function start() {
    if (started)
      return
    started = true
    document.addEventListener('visibilitychange', onVisible)
    watch(() => auth.userId, () => {
      void run()
    })
    void run()
  }

  onScopeDispose(() => {
    document.removeEventListener('visibilitychange', onVisible)
    if (timer)
      clearTimeout(timer)
  })

  return { start }
}
