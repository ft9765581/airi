import type { ConnectionTestResult } from '../connection-test'
import type { KnowledgeBaseStatus } from '../types'

import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { connectionTestTimeoutSeconds, difyErrorCodes, testKnowledgeBaseConnection } from '../connection-test'

/** The page origin, for the message that names the origin to allow. */
function pageOrigin() {
  return typeof window === 'undefined' ? '' : window.location.origin
}

/**
 * Runs a retrieval test and turns the raw result into the text a user reads.
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

  /**
   * Names the cause of a failed test.
   *
   * A request that never reached the service gets one of three plain messages,
   * because a raw browser error ("Failed to fetch") tells a user nothing. The
   * origin message carries the address the service administrator must allow.
   * The service error message is the most accurate source for a request that
   * did reach the service, so it wins there.
   */
  const failureCause = computed(() => {
    const current = result.value
    if (!current)
      return ''

    if (current.failureKind === 'timeout') {
      return t('settings.pages.knowledge-base.result.timeout-hint', {
        seconds: connectionTestTimeoutSeconds,
      })
    }

    if (current.failureKind === 'blocked-origin') {
      return t('settings.pages.knowledge-base.result.blocked-origin-hint', {
        origin: pageOrigin(),
      })
    }

    if (current.failureKind === 'unreachable') {
      return t('settings.pages.knowledge-base.result.unreachable-hint')
    }

    if (current.serviceErrorCode === difyErrorCodes.authorizationFormat) {
      return t('settings.pages.knowledge-base.result.authorization-format-hint')
    }

    if (current.serviceErrorCode === difyErrorCodes.authentication) {
      return t('settings.pages.knowledge-base.result.authentication-hint')
    }

    if (current.serviceErrorCode === difyErrorCodes.knowledgeBaseMissing) {
      return t('settings.pages.knowledge-base.result.knowledge-base-not-found-hint')
    }

    if (current.serviceErrorMessage) {
      return t('settings.pages.knowledge-base.result.service-error', {
        code: current.serviceErrorCode,
        message: current.serviceErrorMessage,
      })
    }

    if (current.httpStatus === 422) {
      return t('settings.pages.knowledge-base.result.missing-knowledge-id-hint')
    }

    if (current.httpStatus === 401 || current.httpStatus === 403) {
      return t('settings.pages.knowledge-base.result.authentication-hint')
    }

    return ''
  })

  const detail = computed(() => {
    const current = result.value
    if (!current)
      return ''

    if (current.httpStatus === undefined) {
      return failureCause.value
    }

    const parts = [
      t('settings.pages.knowledge-base.result.http-detail', {
        status: current.httpStatus,
        latency: current.latencyMs,
      }),
    ]

    if (current.ok && current.recordCount !== undefined) {
      parts.push(t('settings.pages.knowledge-base.result.record-count', {
        count: current.recordCount,
      }))

      // A working connection with no records is a common first-run state: the
      // knowledge base answers, but it holds no content for this query.
      if (current.recordCount === 0) {
        parts.push(t('settings.pages.knowledge-base.result.empty-records-hint'))
      }
    }
    else if (failureCause.value) {
      parts.push(failureCause.value)
    }

    return parts.join(' · ')
  })

  async function run(input: { baseUrl: string, apiKey?: string, knowledgeId?: string }) {
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
