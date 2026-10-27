import { describe, expect, it } from 'vitest'

import { createMemoryEmbedder } from './memory-embedding'

describe('createMemoryEmbedder', () => {
  it('returns no vector when the model is unset', async () => {
    const embedder = createMemoryEmbedder({
      apiKey: '',
      baseURL: '',
      model: '',
    })

    expect(await embedder.embed('用户对花生过敏')).toBeNull()
  })

  it('returns no vector when the base URL is unset', async () => {
    const embedder = createMemoryEmbedder({
      apiKey: 'secret',
      baseURL: '   ',
      model: 'bge-m3',
    })

    expect(await embedder.embed('用户对花生过敏')).toBeNull()
  })
})
