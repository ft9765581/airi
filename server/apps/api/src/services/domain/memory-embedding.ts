import { useLogger } from '@guiiai/logg'
import { embed } from '@xsai/embed'

const logger = useLogger('memory-embedding')

/** Stored width of `user_memories.embedding`. The column and this value stay equal. */
export const MEMORY_EMBEDDING_DIMENSION = 1024

/** How long one embedding request may run, including the retry without `dimensions`. */
const EMBED_TIMEOUT_MS = 2_000

export interface MemoryEmbedder {
  /**
   * Returns one 1024-number vector, or null when embedding is unavailable.
   *
   * Null keeps the fact and leaves search on keyword overlap.
   */
  embed: (text: string) => Promise<number[] | null>
}

export interface MemoryEmbeddingConfig {
  apiKey: string
  baseURL: string
  model: string
}

function usableVector(value: readonly number[] | undefined): number[] | null {
  if (!value || value.length !== MEMORY_EMBEDDING_DIMENSION)
    return null
  if (value.some(entry => !Number.isFinite(entry)))
    return null
  return [...value]
}

/**
 * Builds the embedder for one API process.
 *
 * An empty base URL or model returns null for every text. Search then stays on
 * the local calendar day and keyword overlap. A configured model is called with
 * `dimensions: 1024`. A provider that rejects that field is called once more
 * without it. Both calls share one two-second limit.
 */
export function createMemoryEmbedder(config: MemoryEmbeddingConfig): MemoryEmbedder {
  const baseURL = config.baseURL.trim()
  const model = config.model.trim()
  const apiKey = config.apiKey.trim()
  if (!baseURL || !model)
    return { async embed() { return null } }

  return {
    async embed(text: string) {
      const abortSignal = AbortSignal.timeout(EMBED_TIMEOUT_MS)
      const request = { abortSignal, apiKey: apiKey || undefined, baseURL, input: text, model }

      try {
        const sized = await embed({ ...request, dimensions: MEMORY_EMBEDDING_DIMENSION })
        const vector = usableVector(sized.embedding)
        if (vector)
          return vector
      }
      catch (error) {
        if (abortSignal.aborted) {
          logger.withError(error).warn('Memory embedding timed out')
          return null
        }
      }

      try {
        const plain = await embed(request)
        const vector = usableVector(plain.embedding)
        if (vector)
          return vector
        logger.withFields({ length: plain.embedding?.length ?? 0 }).warn('Memory embedding length was not 1024')
        return null
      }
      catch (error) {
        logger.withError(error).warn('Memory embedding failed')
        return null
      }
    },
  }
}
