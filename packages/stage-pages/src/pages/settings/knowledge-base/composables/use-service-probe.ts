import type { ServiceFailureKind } from '@proj-airi/stage-ui/libs/external-service'

import type { ConnectionTestStatus } from '../types'

import { knowledgeServiceErrorCodes, serviceRequestTimeoutMs } from '@proj-airi/stage-ui/libs/external-service'
import { computed, shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'

/** What one probe answer tells the page, whatever the contract behind it. */
export interface ServiceProbeResponse {
  /** True only when the service answered a success status with no error code. */
  ok: boolean
  /** The status the service returned, when it answered. */
  httpStatus?: number
  /** Round-trip time in milliseconds. */
  latencyMs: number
  /** Why the request did not complete, when it did not complete. */
  failureKind?: ServiceFailureKind
  /** The error code the service body carried. */
  serviceErrorCode?: number
  /** The error message the service body carried. */
  serviceErrorMessage?: string
}

/** The i18n keys that name a failure. Both tabs hold the same set, in their own file. */
export interface ServiceProbePhrases {
  /** The i18n path that holds the hints, such as `settings.pages.knowledge-base.result`. */
  prefix: string
  /** Key under `prefix` for a service that rejects the request: HTTP 400 or 422. */
  rejectedBody: string
  /**
   * Key under `prefix` for a service that reports an absent resource in a
   * successful body.
   *
   * Omit it when the contract reports every failure with a status code. The graph
   * search endpoint does; the retrieval endpoint answers HTTP 200 with error code
   * 2001.
   */
  missingResource?: string
}

/** The page origin, for the message that names the origin to allow. */
function pageOrigin() {
  return typeof window === 'undefined' ? '' : window.location.origin
}

/**
 * Runs one connection probe and turns the raw answer into the text a user reads.
 *
 * Both settings tabs probe an outside service the same way, so both read the same
 * four states and the same failure vocabulary. Only two things differ: where the
 * base address, key and resource id come from, and the line that follows a
 * success. Both come from the caller through `execute` and `describeSuccess`.
 *
 * One instance owns one probe target: a connection form, or one row in a
 * connection list.
 */
export function useServiceProbe<TResponse extends ServiceProbeResponse, TInput>(options: {
  phrases: ServiceProbePhrases
  /** Sends the request. The caller decides which contract it speaks. */
  execute: (input: TInput) => Promise<TResponse>
  /** The lines that follow the HTTP detail when the probe succeeded. */
  describeSuccess: (response: TResponse) => string[]
}) {
  const { t } = useI18n()

  const testing = shallowRef(false)
  const response = shallowRef<TResponse>()

  const status = computed<ConnectionTestStatus>(() => {
    if (testing.value)
      return 'testing'
    if (!response.value)
      return 'untested'

    return response.value.ok ? 'connected' : 'failed'
  })

  /**
   * Names the cause of a failed probe.
   *
   * A request that never reached the service gets one of three plain messages,
   * because a raw browser error ("Failed to fetch") tells a user nothing. The
   * origin message carries the address the service administrator must allow. The
   * service error message is the most accurate source for a request that did
   * reach the service, so it wins there.
   */
  const failureCause = computed(() => {
    const current = response.value
    if (!current)
      return ''

    if (current.failureKind === 'timeout') {
      return t(`${options.phrases.prefix}.timeout-hint`, {
        seconds: serviceRequestTimeoutMs / 1000,
      })
    }

    if (current.failureKind === 'blocked-origin') {
      return t(`${options.phrases.prefix}.blocked-origin-hint`, {
        origin: pageOrigin(),
      })
    }

    if (current.failureKind === 'unreachable') {
      return t(`${options.phrases.prefix}.unreachable-hint`)
    }

    if (current.serviceErrorCode === knowledgeServiceErrorCodes.authorizationFormat) {
      return t(`${options.phrases.prefix}.authorization-format-hint`)
    }

    if (current.serviceErrorCode === knowledgeServiceErrorCodes.authentication) {
      return t(`${options.phrases.prefix}.authentication-hint`)
    }

    if (current.serviceErrorCode === knowledgeServiceErrorCodes.resourceMissing && options.phrases.missingResource) {
      return t(`${options.phrases.prefix}.${options.phrases.missingResource}`)
    }

    if (current.serviceErrorMessage) {
      return t(`${options.phrases.prefix}.service-error`, {
        code: current.serviceErrorCode,
        message: current.serviceErrorMessage,
      })
    }

    // 400 and 422 both mean the service understood the address and refused the
    // request. The retrieval contract answers 422 for a bad body, the graph search
    // contract answers 400 for a bad query or document id.
    if (current.httpStatus === 400 || current.httpStatus === 422) {
      return t(`${options.phrases.prefix}.${options.phrases.rejectedBody}`)
    }

    if (current.httpStatus === 404) {
      return t(`${options.phrases.prefix}.endpoint-not-found-hint`)
    }

    // This app's own API answers these three when it cannot complete the call
    // itself: 503 for a deployment with no address configured, 502 for a service
    // it cannot reach, 504 for a service that ran past the timeout. Without a
    // message, a configuration error shows up as a bare "HTTP 503" and takes the
    // same time to diagnose as a broken connection.
    if (current.httpStatus === 503) {
      return t(`${options.phrases.prefix}.server-not-configured-hint`)
    }

    if (current.httpStatus === 502) {
      return t(`${options.phrases.prefix}.server-unreachable-hint`)
    }

    if (current.httpStatus === 504) {
      return t(`${options.phrases.prefix}.server-timeout-hint`)
    }

    if (current.httpStatus === 401 || current.httpStatus === 403) {
      return t(`${options.phrases.prefix}.authentication-hint`)
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
      t(`${options.phrases.prefix}.http-detail`, {
        status: current.httpStatus,
        latency: current.latencyMs,
      }),
    ]

    if (current.ok) {
      parts.push(...options.describeSuccess(current))
    }
    else if (failureCause.value) {
      parts.push(failureCause.value)
    }

    return parts.join(' · ')
  })

  async function run(input: TInput) {
    testing.value = true
    response.value = undefined

    try {
      response.value = await options.execute(input)
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
