import type { EmbeddingReference } from './classify-embedding'

import { describe, expect, it } from 'vitest'

import { classifyByNeighbours, cosineSimilarity, decideEmbedding } from './classify-embedding'

function reference(id: string, label: 'medical' | 'chat', vector: number[]): EmbeddingReference {
  return { id, label, vector }
}

describe('cosineSimilarity', () => {
  it('scores an identical direction as one', () => {
    expect(cosineSimilarity([1, 0], [2, 0])).toBeCloseTo(1)
  })

  it('scores orthogonal directions as zero', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0)
  })

  it('scores a zero vector as zero instead of NaN', () => {
    expect(cosineSimilarity([0, 0], [1, 0])).toBe(0)
  })
})

describe('classifyByNeighbours', () => {
  it('picks the class whose nearest references are closer', () => {
    const vote = classifyByNeighbours([1, 0], [
      reference('med-01', 'medical', [0.9, 0.1]),
      reference('med-02', 'medical', [0.8, 0.2]),
      reference('chat-01', 'chat', [0, 1]),
    ])

    expect(vote?.label).toBe('medical')
    expect(vote?.medicalScore).toBeGreaterThan(vote?.chatScore ?? 0)
  })

  it('reports the gap as the margin', () => {
    const vote = classifyByNeighbours([1, 0], [
      reference('med-01', 'medical', [0.8, 0.6]),
      reference('chat-01', 'chat', [0.6, 0.8]),
    ])

    expect(vote?.margin).toBeCloseTo(0.2, 5)
  })

  it('keeps the nearest references in descending order', () => {
    const vote = classifyByNeighbours([1, 0], [
      reference('med-01', 'medical', [0.2, 0.98]),
      reference('med-02', 'medical', [0.8, 0.6]),
      reference('chat-01', 'chat', [0, 1]),
    ], { neighbours: 2 })

    expect(vote?.nearest.map(neighbour => neighbour.id)).toEqual(['med-02', 'med-01'])
  })

  it('averages only the closest references of a class', () => {
    // The far medical reference must not pull the medical score down.
    const vote = classifyByNeighbours([1, 0], [
      reference('med-01', 'medical', [0.8, 0.6]),
      reference('med-02', 'medical', [0, 1]),
      reference('chat-01', 'chat', [0, 1]),
    ], { neighbours: 1 })

    expect(vote?.medicalScore).toBeCloseTo(0.8, 5)
  })

  it('returns nothing when there is no reference set', () => {
    // A missing reference set must not read as a confident chat answer.
    expect(classifyByNeighbours([1, 0], [])).toBeUndefined()
  })

  it('leaves a near-duplicate rewrite out of the vote and counts it', () => {
    // ROOT CAUSE:
    //
    // Only the sample itself was excluded, so a close rewrite of a medical
    // sentence voted for medical and lifted the score. The evaluation then read as
    // generalisation while it measured wording.
    const vote = classifyByNeighbours([1, 0], [
      reference('med-01', 'medical', [0.999, 0.001]),
      reference('med-02', 'medical', [0.7, 0.714]),
      reference('chat-01', 'chat', [0, 1]),
    ])

    expect(vote?.excludedDuplicates).toBe(1)
    expect(vote?.nearest.map(neighbour => neighbour.id)).not.toContain('med-01')
  })

  it('returns nothing when every reference is a rewrite of the query', () => {
    const vote = classifyByNeighbours([1, 0], [
      reference('med-01', 'medical', [1, 0]),
      reference('chat-01', 'chat', [1, 0]),
    ])

    expect(vote).toBeUndefined()
  })
})

describe('decideEmbedding', () => {
  const vote = (label: 'medical' | 'chat', margin: number) => ({
    label,
    medicalScore: 0.5,
    chatScore: 0.5,
    margin,
    nearest: [],
    // These cases only exercise the margin rule, so the dedupe count is zero:
    // no neighbour was removed before the scores were aggregated.
    excludedDuplicates: 0,
  })

  it('keeps a confident vote', () => {
    expect(decideEmbedding(vote('medical', 0.2))).toBe('medical')
  })

  it('reports a close vote as uncertain instead of chat', () => {
    // Counting a close vote as chat would record a failure as a correct answer.
    expect(decideEmbedding(vote('chat', 0.001))).toBe('uncertain')
  })
})
