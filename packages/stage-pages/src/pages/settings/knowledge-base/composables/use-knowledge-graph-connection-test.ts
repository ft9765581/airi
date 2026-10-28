import type { KnowledgeGraphResponse } from '@proj-airi/stage-ui/libs/knowledge-graph'

import {
  knowledgeGraphProbeLimit,
  knowledgeGraphProbeQuery,
  requestKnowledgeGraphSearch,
} from '@proj-airi/stage-ui/libs/knowledge-graph'
import { useI18n } from 'vue-i18n'

import { useServiceProbe } from './use-service-probe'

/** The values a knowledge graph probe needs, as the form and the list row hold them. */
export interface KnowledgeGraphTestInput {
  baseUrl: string
  apiKey?: string
  bookId?: string
}

/**
 * Runs a knowledge graph search test and turns the raw response into the text a
 * user reads.
 *
 * One instance owns one test target: the connection form, or one row in the
 * connection list.
 */
export function useKnowledgeGraphConnectionTest() {
  const { t } = useI18n()

  return useServiceProbe<KnowledgeGraphResponse, KnowledgeGraphTestInput>({
    phrases: {
      prefix: 'settings.pages.knowledge-base.graph.result',
      // The search endpoint reports a bad document id or a bad query with HTTP
      // 400, not 422, so both hints share the rejected-request message.
      rejectedBody: 'rejected-query-hint',
      missingResource: 'not-found-hint',
    },
    execute: input => requestKnowledgeGraphSearch({
      baseUrl: input.baseUrl,
      apiKey: input.apiKey,
      bookId: input.bookId,
      query: knowledgeGraphProbeQuery,
      limit: knowledgeGraphProbeLimit,
    }),
    describeSuccess: (response) => {
      const lines = [
        // The service caps its answer at the requested limit, so the count alone
        // would read as "the graph holds this many relations".
        t('settings.pages.knowledge-base.graph.result.relation-count', {
          count: response.total,
          limit: knowledgeGraphProbeLimit,
        }),
      ]

      if (response.mode)
        lines.push(t('settings.pages.knowledge-base.graph.result.mode', { mode: response.mode }))

      // The probe word is a real medical term, but the graph answers in lexical
      // mode, so zero hits still says nothing about the graph being empty.
      if (response.total === 0)
        lines.push(t('settings.pages.knowledge-base.graph.result.empty-graph-hint'))

      return lines
    },
  })
}
