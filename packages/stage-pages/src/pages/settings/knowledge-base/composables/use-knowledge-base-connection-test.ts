import type { KnowledgeBaseResponse } from '@proj-airi/stage-ui/libs/knowledge-base'

import { knowledgeBaseProbeQuery, requestKnowledgeBaseRetrieval } from '@proj-airi/stage-ui/libs/knowledge-base'
import { useI18n } from 'vue-i18n'

import { useServiceProbe } from './use-service-probe'

/** The values a knowledge base probe needs, as the form and the list row hold them. */
export interface KnowledgeBaseTestInput {
  baseUrl: string
  apiKey?: string
  knowledgeBaseId: string
}

/**
 * Runs a knowledge base retrieval test and turns the raw response into the text a
 * user reads.
 *
 * One instance owns one test target: the connection form, or one row in the
 * connection list.
 */
export function useKnowledgeBaseConnectionTest() {
  const { t } = useI18n()

  return useServiceProbe<KnowledgeBaseResponse, KnowledgeBaseTestInput>({
    phrases: {
      prefix: 'settings.pages.knowledge-base.result',
      rejectedBody: 'missing-knowledge-id-hint',
      missingResource: 'knowledge-base-not-found-hint',
    },
    execute: input => requestKnowledgeBaseRetrieval({
      baseUrl: input.baseUrl,
      apiKey: input.apiKey,
      knowledgeBaseId: input.knowledgeBaseId,
      query: knowledgeBaseProbeQuery,
      topK: 1,
    }),
    describeSuccess: (response) => {
      const lines = [
        t('settings.pages.knowledge-base.result.record-count', {
          count: response.records.length,
        }),
      ]

      // A working connection with no records is a common first-run state: the
      // knowledge base answers, but it holds no content for the probe query.
      if (response.records.length === 0)
        lines.push(t('settings.pages.knowledge-base.result.empty-records-hint'))

      return lines
    },
  })
}
