/** The minimum share of query tokens that must appear in a fact. */
export const MIN_MATCH_SCORE = 1 / 3

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
  return 0
}

/**
 * Scores how much of the current message appears in one fact.
 *
 * A shared substring of the whole message scores 1. Otherwise the score is the
 * stronger of: query tokens found in the fact, fact tokens found in the query,
 * or a small topic bridge for age questions. This stays as keyword search and
 * does not call an embedding model.
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
