/** The minimum share of query tokens that must appear in a fact. */
export const MIN_MATCH_SCORE = 1 / 3

/**
 * Cosine similarity at which a fact enters the vector list.
 *
 * The service compares this with `1 - (embedding <=> query)`. Identical vectors
 * score 1. A lower score can still enter through the word list.
 */
export const MIN_VECTOR_SCORE = 0.78

/**
 * Smoothing constant for reciprocal rank fusion.
 *
 * A list's first row contributes 1/61. A fact on both lists outranks a fact on
 * only one list.
 */
export const RRF_K = 60

/**
 * Overlap at which a new fact replaces an older fact with the same meaning.
 *
 * The profile rollup uses the same overlap to replace one profile line.
 */
export const SUPERSEDE_SCORE = 0.6

const LATIN_STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'be',
  'did',
  'do',
  'does',
  'for',
  'how',
  'in',
  'is',
  'it',
  'me',
  'my',
  'of',
  'on',
  'or',
  'our',
  'that',
  'the',
  'this',
  'to',
  'was',
  'we',
  'were',
  'what',
  'when',
  'where',
  'why',
  'with',
  'you',
  'your',
])

/**
 * Words that ask about age in Chinese.
 *
 * A question like "我多大" shares no character bigram with "用户今年30岁", so
 * keyword overlap alone misses the fact. This bridge keeps the age fact.
 */
const AGE_QUERY_PATTERN = /多大|几岁|年龄|年纪|岁数/
/** Words that mark a stored fact as an age fact. */
const AGE_FACT_PATTERN = /岁|年龄|年纪|\d+\s*岁/

/**
 * Words that ask which allergy is stored.
 *
 * "我对什么过敏" shares only "过敏" with "用户对头孢过敏", so the token score
 * stays under the match bar. A stored allergy sentence does not match this
 * pattern, so one drug allergy does not replace another.
 */
const ALLERGY_QUERY_PATTERN = /什么过敏|哪些过敏|过敏史|有没有过敏|是否过敏|过敏吗|药物过敏|食物过敏/
/** Words that mark a stored fact as an allergy fact. */
const ALLERGY_FACT_PATTERN = /过敏/

/**
 * Builds the search tokens for one Chinese or mixed string.
 *
 * Digits stay as their own tokens. A one-character Chinese run stays as one
 * token. Longer Chinese runs become adjacent pairs. Latin words of three or
 * more letters stay as words.
 */
function matchTokens(value: string): string[] {
  const tokens: string[] = []

  for (const match of value.matchAll(/\d+/g))
    tokens.push(match[0])

  for (const match of value.matchAll(/[a-z]{3,}/g)) {
    if (!LATIN_STOPWORDS.has(match[0]))
      tokens.push(match[0])
  }

  for (const match of value.matchAll(/[\u3400-\u9FFF]+/g)) {
    const run = match[0]
    if (run.length === 1) {
      tokens.push(run)
      continue
    }
    for (let index = 0; index < run.length - 1; index += 1)
      tokens.push(run.slice(index, index + 2))
  }

  return tokens
}

function tokenOverlapScore(from: string, into: string): number {
  const tokens = matchTokens(from)
  if (!tokens.length)
    return 0

  let hits = 0
  for (const token of tokens) {
    if (into.includes(token))
      hits += 1
  }
  return hits / tokens.length
}

function topicBridgeScore(query: string, content: string): number {
  if (AGE_QUERY_PATTERN.test(query) && AGE_FACT_PATTERN.test(content))
    return 2 / 3
  if (ALLERGY_QUERY_PATTERN.test(query) && ALLERGY_FACT_PATTERN.test(content))
    return 2 / 3
  return 0
}

/**
 * Scores how much of the current message appears in one fact.
 *
 * A shared substring of the whole message scores 1. Otherwise the score is the
 * stronger of: query tokens found in the fact, fact tokens found in the query,
 * or a small topic bridge for age and allergy questions. This function stays on the words.
 * The memory service adds cosine similarity beside this score when a vector exists.
 */
export function scoreMemoryMatch(query: string, content: string): number {
  const normalizedQuery = query.trim().toLowerCase().replace(/\s+/g, ' ')
  const normalizedContent = content.trim().toLowerCase().replace(/\s+/g, ' ')
  if (normalizedQuery.length < 2 || !normalizedContent)
    return 0

  if (normalizedContent.includes(normalizedQuery) || normalizedQuery.includes(normalizedContent))
    return 1

  return Math.max(
    tokenOverlapScore(normalizedQuery, normalizedContent),
    tokenOverlapScore(normalizedContent, normalizedQuery),
    topicBridgeScore(normalizedQuery, normalizedContent),
  )
}

/** The stronger overlap of the two strings, in either direction. */
export function memoryOverlap(left: string, right: string): number {
  return Math.max(scoreMemoryMatch(left, right), scoreMemoryMatch(right, left))
}

/**
 * Assigns one rank per id. Equal scores share a rank.
 *
 * The next lower score takes the following position, so two tied firsts make
 * the next row rank 3.
 */
export function fusionRanks<T>(items: readonly T[], idOf: (item: T) => string, scoreOf: (item: T) => number): Map<string, number> {
  const sorted = items
    .map((item, index) => ({ item, index, score: scoreOf(item) }))
    .sort((left, right) => right.score - left.score || left.index - right.index)

  const ranks = new Map<string, number>()
  let rank = 1
  for (let position = 0; position < sorted.length; position += 1) {
    const current = sorted[position]
    const previous = sorted[position - 1]
    if (!current)
      continue
    if (previous && previous.score !== current.score)
      rank = position + 1
    ranks.set(idOf(current.item), rank)
  }
  return ranks
}

/**
 * Adds `1 / (60 + rank)` from each list.
 *
 * A fact missing from a list adds nothing for that list.
 *
 * @example
 * reciprocalRankFusion([new Map([['a', 1]]), new Map([['a', 1], ['b', 1]])])
 * // => Map { 'a' => 2/61, 'b' => 1/61 }
 */
export function reciprocalRankFusion(lists: ReadonlyArray<ReadonlyMap<string, number>>): Map<string, number> {
  const scores = new Map<string, number>()
  for (const list of lists) {
    for (const [id, rank] of list) {
      scores.set(id, (scores.get(id) ?? 0) + 1 / (RRF_K + rank))
    }
  }
  return scores
}
