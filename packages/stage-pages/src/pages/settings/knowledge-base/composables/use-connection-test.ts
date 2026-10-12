import type { ConnectionTestResult } from '../connection-test'
import type { KnowledgeBaseStatus } from '../types'

import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { connectionTestTimeoutSeconds, testKnowledgeBaseConnection } from '../connection-test'

/**
 * Runs a connection test and turns the raw result into the text a user reads.
 *
 * One instance owns one test target: the new-connection form, or one row in the
 * connection list. The raw result stays separate from the display text, so the
 * request module carries no user-facing strings.
 */
export function useKnowledgeBaseConnectionTest() {
  const { t } = useI18n()

  const testing = ref(false)
  const result = ref<ConnectionTestResult>()

  const status = computed<KnowledgeBaseStatus>(() => {
    if (testing.value)
      return 'testing'
    if (!result.value)
      return 'untested'

    return result.value.ok ? 'connected' : 'failed'
  })

  const detail = computed(() => {
    const current = result.value
    if (!current)
      return ''

    if (current.timedOut) {
      return t('settings.pages.knowledge-base.result.timeout-hint', {
        seconds: connectionTestTimeoutSeconds,
      })
    }

    if (current.errorMessage) {
      return [
        current.errorMessage,
        t('settings.pages.knowledge-base.result.unreachable-hint'),
      ].join(' · ')
    }

    if (current.httpStatus === undefined)
      return ''

    const httpDetail = t('settings.pages.knowledge-base.result.http-detail', {
      status: current.httpStatus,
      latency: current.latencyMs,
    })

    if (current.httpStatus === 401 || current.httpStatus === 403) {
      return [
        httpDetail,
        t('settings.pages.knowledge-base.result.unauthorized-hint'),
      ].join(' · ')
    }

    return httpDetail
  })

  async function run(input: { baseUrl: string, apiKey?: string }) {
    testing.value = true
    result.value = undefined

    try {
      result.value = await testKnowledgeBaseConnection(input)
    }
    finally {
      testing.value = false
    }
  }

  return {
    testing,
    result,
    status,
    detail,
    run,
  }
}
