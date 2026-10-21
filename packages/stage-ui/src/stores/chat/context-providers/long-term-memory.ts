import type { ContextMessage, RuntimeContextProviderInput } from '@proj-airi/core-agent'

import { errorMessageFrom } from '@moeru/std'
import { ContextUpdateStrategy } from '@proj-airi/server-sdk'
import { nanoid } from 'nanoid'

import { searchMemories } from '../../../libs/memory-api'
import { formatMemoryContext } from '../../../libs/memory-context'
import { useAuthStore } from '../../auth'
import { useAiriCardStore } from '../../modules/airi-card'

const LONG_TERM_MEMORY_CONTEXT_ID = 'system:long-term-memory'

/**
 * How long a send waits for stored facts.
 *
 * Retrieval runs before the prompt is composed, so a slow service delays the
 * answer. A send that waits past this limit proceeds without the facts.
 */
const sendTimeoutMs = 3000

/**
 * Injects stored facts that match the current message.
 *
 * Signed-out chat does not read the account store. A retrieval failure adds
 * no context and does not stop the send. No matching fact leaves the prompt
 * unchanged.
 */
export async function createLongTermMemoryContext(
  input: RuntimeContextProviderInput,
): Promise<ContextMessage | null> {
  const query = input.message.trim()
  if (!query)
    return null
  if (useAuthStore().userId === 'local')
    return null

  const characterId = useAiriCardStore().activeCardId || 'default'

  try {
    const memories = await searchMemories(query, characterId, AbortSignal.timeout(sendTimeoutMs))
    const text = formatMemoryContext(memories)
    if (!text)
      return null

    return {
      id: nanoid(),
      contextId: LONG_TERM_MEMORY_CONTEXT_ID,
      strategy: ContextUpdateStrategy.ReplaceSelf,
      // The context registry buckets and labels entries by `metadata.source.id`.
      // Without it the prompt renders this block as "- unknown: ...".
      metadata: { source: { id: LONG_TERM_MEMORY_CONTEXT_ID } },
      text,
      createdAt: Date.now(),
    }
  }
  catch (error) {
    if (import.meta.env.DEV)
      console.warn('[long-term-memory] retrieval failed', errorMessageFrom(error))
    return null
  }
}
