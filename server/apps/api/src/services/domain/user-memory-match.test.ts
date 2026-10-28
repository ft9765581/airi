import { describe, expect, it } from 'vitest'

import { scoreMemoryMatch } from './user-memory'
import { fusionRanks, memoryOverlap, MIN_MATCH_SCORE, reciprocalRankFusion, RRF_K, SUPERSEDE_SCORE } from './user-memory-match'

describe('scoreMemoryMatch', () => {
  it('links an age question to a stored age fact', () => {
    expect(scoreMemoryMatch('我多大你不知道吗', '用户今年30岁。')).toBeGreaterThanOrEqual(1 / 3)
  })

  it('still rejects an unrelated weather question', () => {
    expect(scoreMemoryMatch('今天天气不错', '用户今年30岁。')).toBeLessThan(1 / 3)
  })

  it('keeps digit tokens so a year fact can match', () => {
    expect(scoreMemoryMatch('我是不是30岁', '用户今年30岁。')).toBeGreaterThanOrEqual(1 / 3)
  })

  it('links an allergy question to each stored allergy fact', () => {
    expect(scoreMemoryMatch('我对什么过敏', '用户对头孢过敏。')).toBeGreaterThanOrEqual(MIN_MATCH_SCORE)
    expect(scoreMemoryMatch('我对什么过敏', '用户对青霉素过敏')).toBeGreaterThanOrEqual(MIN_MATCH_SCORE)
  })

  it('does not treat one allergy fact as a replacement for another', () => {
    expect(memoryOverlap('用户对头孢过敏。', '用户对青霉素过敏')).toBeLessThan(SUPERSEDE_SCORE)
  })

  it('leaves an allergy fact out of a weather question', () => {
    expect(scoreMemoryMatch('今天天气不错', '用户对头孢过敏。')).toBeLessThan(MIN_MATCH_SCORE)
  })
})

describe('reciprocalRankFusion', () => {
  it('scores a fact on both lists above a fact on one list', () => {
    const scores = reciprocalRankFusion([
      new Map([['both', 1], ['words', 2]]),
      new Map([['both', 1], ['vector', 2]]),
    ])

    expect(scores.get('both')).toBe(2 / (RRF_K + 1))
    expect(scores.get('words')).toBe(1 / (RRF_K + 2))
    expect(scores.get('vector')).toBe(1 / (RRF_K + 2))
  })

  it('gives equal scores the same rank', () => {
    const ranks = fusionRanks(
      [{ id: 'a', score: 1 }, { id: 'b', score: 1 }, { id: 'c', score: 0.5 }],
      item => item.id,
      item => item.score,
    )

    expect(ranks.get('a')).toBe(1)
    expect(ranks.get('b')).toBe(1)
    expect(ranks.get('c')).toBe(3)
  })
})
