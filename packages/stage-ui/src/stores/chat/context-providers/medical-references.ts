import type { ContextMessage } from '@proj-airi/core-agent'

import { ContextUpdateStrategy } from '@proj-airi/server-sdk'
import { nanoid } from 'nanoid'

import { retrieveKnowledgeBaseContext } from './knowledge-base'
import { retrieveKnowledgeGraphContext } from './knowledge-graph'

const MEDICAL_REFERENCE_CONTEXT_ID = 'system:medical-reference'

/**
 * Builds the reference block one medical turn carries.
 *
 * Two sources answer the same question. The knowledge bases hold passages, and
 * the knowledge graph holds relations between entities. Both arrive as one
 * context message, so a turn carries one reference block and the prompt keeps one
 * place for quoted data.
 *
 * The two lookups run at the same time, and each settles alone: a graph that is
 * down costs its own section, not the passages. A turn with neither source still
 * answers, because the caller treats a null result as "no references".
 *
 * @example
 * await retrieveMedicalReferenceContext('产后多久可以洗澡')
 * // => { contextId: 'system:medical-reference', text: 'The block below…\n\n…' } | null
 */
export async function retrieveMedicalReferenceContext(query: string): Promise<ContextMessage | null> {
  const [passages, relations] = await Promise.allSettled([
    retrieveKnowledgeBaseContext(query, 'medical'),
    retrieveKnowledgeGraphContext(query, 'medical'),
  ])

  const blocks = [passages, relations]
    .map(settled => settled.status === 'fulfilled' ? settled.value?.text : undefined)
    .filter((text): text is string => !!text)

  if (!blocks.length)
    return null

  return {
    id: nanoid(),
    contextId: MEDICAL_REFERENCE_CONTEXT_ID,
    strategy: ContextUpdateStrategy.ReplaceSelf,
    // The context registry buckets and labels entries by `metadata.source.id`.
    metadata: { source: { id: MEDICAL_REFERENCE_CONTEXT_ID } },
    text: blocks.join('\n\n'),
    createdAt: Date.now(),
  }
}
