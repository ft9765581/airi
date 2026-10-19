import type { KnowledgeBaseResponse } from '@proj-airi/stage-ui/libs/knowledge-base'

import type { KnowledgeBaseStatus } from '../types'

import {
  knowledgeBaseErrorCodes,
  knowledgeBaseProbeQuery,
  knowledgeBaseRequestTimeoutMs,
  requestKnowledgeBaseRetrieval,
} from '@proj-airi/stage-ui/libs/knowledge-base'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

/** The page origin, for the message that names the origin to allow. */
function pageOrigin() {
  return typeof window === 'undefined' ? '' : window.location.origin
}

/**
 * Runs a retrieval test and turns the raw response into the text a user reads.
 *
 * One instance owns one test target: the connection form, or one row in the
 * connection list.
 */
export function useKnowledgeBaseConnectionTest() {
  const { t } = useI18n()

  const testing = ref(false)
  const response = ref<KnowledgeBaseResponse>()

  const status = computed<KnowledgeBaseStatus>(() => {
    if (testing.value)
      return 'testing'
    if (!response.value)
      return 'untested'

    return response.value.ok ? 'connected' : 'failed'
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
    const current = response.value
    if (!current)
      return ''

    if (current.failureKind === 'timeout') {
      return t('settings.pages.knowledge-base.result.timeout-hint', {
        seconds: knowledgeBaseRequestTimeoutMs / 1000,
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

    if (current.serviceErrorCode === knowledgeBaseErrorCodes.authorizationFormat) {
      return t('settings.pages.knowledge-base.result.authorization-format-hint')
    }

    if (current.serviceErrorCode === knowledgeBaseErrorCodes.authentication) {
      return t('settings.pages.knowledge-base.result.authentication-hint')
    }

    if (current.serviceErrorCode === knowledgeBaseErrorCodes.knowledgeBaseMissing) {
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
    const current = response.value
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

    if (current.ok) {
      parts.push(t('settings.pages.knowledge-base.result.record-count', {
        count: current.records.length,
      }))

      // A working connection with no records is a common first-run state: the
      // knowledge base answers, but it holds no content for the probe query.
      if (current.records.length === 0) {
        parts.push(t('settings.pages.knowledge-base.result.empty-records-hint'))
      }
    }
    else if (failureCause.value) {
      parts.push(failureCause.value)
    }

    return parts.join(' · ')
  })

  async function run(input: { baseUrl: string, apiKey?: string, knowledgeBaseId: string }) {
    testing.value = true
    response.value = undefined

    try {
      response.value = await requestKnowledgeBaseRetrieval({
        baseUrl: input.baseUrl,
        apiKey: input.apiKey,
        knowledgeBaseId: input.knowledgeBaseId,
        query: knowledgeBaseProbeQuery,
        topK: 1,
        timeoutMs: knowledgeBaseRequestTimeoutMs,
      })
    }
    finally {
      testing.value = false
    }
  }

  return {
    testing,
    response,
    status,
    detail,
    run,
  }
}
