import type { EmbeddingVoteRecord } from './classify-embedding'

import { describe, expect, it } from 'vitest'

import { evaluateEmbeddingVotes } from './classify-embedding'

function record(id: string, expected: 'medical' | 'chat', margin: number, label: 'medical' | 'chat'): EmbeddingVoteRecord {
  return {
    id,
    input: id,
    expected,
    vote: {
      label,
      medicalScore: label === 'medical' ? 0.5 + margin / 2 : 0.5 - margin / 2,
      chatScore: label === 'medical' ? 0.5 - margin / 2 : 0.5 + margin / 2,
      margin,
      excludedDuplicates: 0,
      nearest: [],
    },
  }
}

describe('evaluateEmbeddingVotes', () => {
  it('counts a medical hit and a chat false positive', () => {
    const report = evaluateEmbeddingVotes([
      record('med-01', 'medical', 0.2, 'medical'),
      record('chat-01', 'chat', 0.2, 'medical'),
    ], { margin: 0.02 })

    expect(report.medicalRecall).toBe(1)
    expect(report.chatFalsePositiveRate).toBe(1)
    expect(report.misses).toEqual([])
    expect(report.falsePositives.map(item => item.id)).toEqual(['chat-01'])
  })

  it('reports the denominators behind each rate', () => {
    const report = evaluateEmbeddingVotes([
      record('med-01', 'medical', 0.2, 'medical'),
      record('med-02', 'medical', 0.2, 'medical'),
      record('chat-01', 'chat', 0.2, 'chat'),
    ], { margin: 0.02 })

    expect(report.medicalTotal).toBe(2)
    expect(report.chatTotal).toBe(1)
  })

  it('counts a vote below the threshold as uncertain, not as chat', () => {
    const report = evaluateEmbeddingVotes([
      record('med-01', 'medical', 0.005, 'medical'),
    ], { margin: 0.02 })

    expect(report.uncertain).toBe(1)
    expect(report.medicalRecall).toBe(0)
    // An uncertain verdict must not travel as a wrong medical answer either.
    expect(report.chatFalsePositiveRate).toBe(0)
    expect(report.misses.map(item => item.id)).toEqual(['med-01'])
  })

  it('re-scores the same votes for another threshold', () => {
    const records = [record('med-01', 'medical', 0.03, 'medical')]

    expect(evaluateEmbeddingVotes(records, { margin: 0.02 }).medicalRecall).toBe(1)
    expect(evaluateEmbeddingVotes(records, { margin: 0.05 }).medicalRecall).toBe(0)
  })

  it('reports no rates when a class has no sample', () => {
    const report = evaluateEmbeddingVotes([record('med-01', 'medical', 0.2, 'medical')], { margin: 0.02 })

    expect(report.chatTotal).toBe(0)
    expect(report.chatFalsePositiveRate).toBe(0)
  })
})
