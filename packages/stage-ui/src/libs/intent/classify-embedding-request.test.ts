import { beforeEach, describe, expect, it, vi } from 'vitest'

import { requestEmbeddings } from './classify-embedding'

const embedManyMock = vi.hoisted(() => vi.fn())

vi.mock('@xsai/embed', () => ({
  embedMany: embedManyMock,
}))

beforeEach(() => {
  embedManyMock.mockReset()
})

describe('requestEmbeddings', () => {
  // ROOT CAUSE:
  //
  // One request carried every input. Aliyun's text-embedding-v4 answers
  // `InternalError.Algo.InvalidParameter: batch size is invalid, it should not be
  // larger than 10` for a 92-sample run, so the whole reference set failed.
  //
  // The helper now sends at most `embeddingBatchSize` inputs per request and
  // keeps the replies in order.
  it('splits a long sample set into provider-sized batches', async () => {
    embedManyMock.mockImplementation(async ({ input }: { input: string[] }) => ({
      embeddings: input.map(() => [1, 0]),
    }))

    const vectors = await requestEmbeddings(
      { baseURL: 'https://example.test/v1', model: 'test-embedding' },
      Array.from({ length: 25 }, (_, index) => `sample-${index}`),
    )

    expect(embedManyMock).toHaveBeenCalledTimes(3)
    expect(embedManyMock.mock.calls[0][0].input).toHaveLength(10)
    expect(embedManyMock.mock.calls[2][0].input).toHaveLength(5)
    expect(vectors).toHaveLength(25)
  })

  it('keeps the replies in input order', async () => {
    embedManyMock.mockImplementation(async ({ input }: { input: string[] }) => ({
      embeddings: input.map(text => [Number(text.slice(7)), 0]),
    }))

    const vectors = await requestEmbeddings(
      { baseURL: 'https://example.test/v1', model: 'test-embedding' },
      Array.from({ length: 12 }, (_, index) => `sample-${index}`),
      { batchSize: 5 },
    )

    expect(vectors.map(vector => vector[0])).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
  })

  it('forwards the key only when one is configured', async () => {
    embedManyMock.mockResolvedValue({ embeddings: [[1]] })

    await requestEmbeddings({ baseURL: 'https://example.test/v1', model: 'm' }, ['a'])
    expect(embedManyMock.mock.calls[0][0]).not.toHaveProperty('apiKey')

    await requestEmbeddings({ baseURL: 'https://example.test/v1', model: 'm', apiKey: 'k' }, ['a'])
    expect(embedManyMock.mock.calls[1][0]).toHaveProperty('apiKey', 'k')
  })

  it('rejects when a batch never answers', async () => {
    embedManyMock.mockImplementation(() => new Promise(() => {}))

    await expect(requestEmbeddings(
      { baseURL: 'https://example.test/v1', model: 'm' },
      ['a'],
      { timeoutMs: 20 },
    )).rejects.toThrow(/timed out after 20ms/)
  })
})
