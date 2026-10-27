import type { IntentDecisionLabel } from './contract'

import { embedMany } from '@xsai/embed'

/** A labelled sentence and the vector a model produced for it. */
export interface EmbeddingReference {
  id: string
  label: IntentDecisionLabel
  vector: number[]
}

/** How to reach an OpenAI-compatible embedding route. */
export interface EmbeddingEndpoint {
  baseURL: string
  model: string
  apiKey?: string
}

/** One labelled neighbour, kept so a result can be explained instead of asserted. */
export interface EmbeddingNeighbour {
  id: string
  label: IntentDecisionLabel
  score: number
}

/**
 * What a neighbourhood vote concluded, with the numbers behind it.
 *
 * `margin` is the gap between the two class scores. It is the only value the
 * caller needs to decide whether the vote is confident enough to stand alone,
 * because an embedding always returns *some* nearest neighbour.
 */
export interface EmbeddingVote {
  label: IntentDecisionLabel
  medicalScore: number
  chatScore: number
  margin: number
  /** References too close to the query to count as an independent vote. */
  excludedDuplicates: number
  nearest: EmbeddingNeighbour[]
}

/** What one embedding vote claims: a label, or that it does not know. */
export type EmbeddingOutcome = IntentDecisionLabel | 'uncertain'

/**
 * How many nearest references vote for one class.
 *
 * One neighbour is not enough: "鍖婚櫌鍋滆溅" and "澶嶆煡鎸傚摢涓" sit close to each
 * other, so a single neighbour would flip the label on wording alone.
 */
export const embeddingNeighbours = 5

/**
 * The margin a vote needs to stand on its own.
 *
 * Provisional. The design document requires thresholds chosen on the development
 * set and recorded in the report, so this constant is a starting point for the
 * comparison page, not a routing decision.
 */
export const embeddingMargin = 0.02

/**
 * Cosine similarity, which assumes unit-length vectors as the embedding route
 * returns them.
 *
 * A zero vector scores zero instead of `NaN`, so an empty input cannot poison an
 * average.
 *
 * @example
 * cosineSimilarity([1, 0], [1, 0])
 * // => 1
 */
export function cosineSimilarity(left: readonly number[], right: readonly number[]): number {
  const length = Math.min(left.length, right.length)
  let dot = 0
  let leftNorm = 0
  let rightNorm = 0

  for (let index = 0; index < length; index += 1) {
    dot += left[index] * right[index]
    leftNorm += left[index] * left[index]
    rightNorm += right[index] * right[index]
  }

  if (leftNorm === 0 || rightNorm === 0)
    return 0

  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm))
}

function meanScore(scores: number[], neighbours: number): number {
  if (!scores.length)
    return 0

  const top = [...scores].sort((left, right) => right - left).slice(0, neighbours)
  return top.reduce((sum, score) => sum + score, 0) / top.length
}

/**
 * Similarity above which a reference counts as a rewrite of the query.
 *
 * A near-duplicate sentence is the same text in other words, so it says nothing
 * about the classifier's ability to generalise. Its vote is dropped and counted,
 * instead of being allowed to lift the score.
 */
export const embeddingDuplicateSimilarity = 0.98

/**
 * Classifies one vector by the mean score of its closest references per class.
 *
 * Returns `undefined` when there is nothing to compare against, so a missing
 * reference set cannot read as "confidently chat".
 *
 * A reference that scores above `duplicateSimilarity` is left out of the vote and
 * counted in `excludedDuplicates`: it is close to being the same sentence as the
 * query, which would measure the reference set instead of the classifier.
 *
 * @example
 * classifyByNeighbours([1, 0], [
 *   { id: 'med-01', label: 'medical', vector: [1, 0] },
 *   { id: 'chat-01', label: 'chat', vector: [0, 1] },
 * ])?.label
 * // => 'medical'
 */
export function classifyByNeighbours(
  query: readonly number[],
  references: readonly EmbeddingReference[],
  options?: { neighbours?: number, duplicateSimilarity?: number },
): EmbeddingVote | undefined {
  if (!references.length)
    return undefined

  const neighbours = options?.neighbours ?? embeddingNeighbours
  const duplicateSimilarity = options?.duplicateSimilarity ?? embeddingDuplicateSimilarity
  const medicalScores: number[] = []
  const chatScores: number[] = []
  const nearest: EmbeddingNeighbour[] = []
  let excludedDuplicates = 0
  let considered = 0

  for (const reference of references) {
    const score = cosineSimilarity(query, reference.vector)

    // A duplicate is the same sentence in other words, so it must vote in neither
    // class: keeping its label would lift that class by wording alone.
    if (score >= duplicateSimilarity) {
      excludedDuplicates += 1
      continue
    }

    considered += 1
    nearest.push({ id: reference.id, label: reference.label, score })

    if (reference.label === 'medical')
      medicalScores.push(score)
    else
      chatScores.push(score)
  }

  // Every reference being a rewrite of the query leaves nothing to vote with.
  if (!considered)
    return undefined

  const medicalScore = meanScore(medicalScores, neighbours)
  const chatScore = meanScore(chatScores, neighbours)

  return {
    label: medicalScore >= chatScore ? 'medical' : 'chat',
    medicalScore,
    chatScore,
    margin: Math.abs(medicalScore - chatScore),
    excludedDuplicates,
    nearest: nearest.sort((left, right) => right.score - left.score).slice(0, neighbours),
  }
}

/**
 * Turns a vote into what a router could act on.
 *
 * A vote below the margin is `uncertain` rather than `chat`: the design document
 * requires that case to fall through to the generative classifier, and reporting
 * it as chat would count a failure as a correct answer.
 *
 * @example
 * decideEmbedding({ label: 'medical', medicalScore: 0.7, chatScore: 0.2, margin: 0.5, nearest: [] })
 * // => 'medical'
 */
export function decideEmbedding(vote: EmbeddingVote, options?: { margin?: number }): EmbeddingOutcome {
  const margin = options?.margin ?? embeddingMargin
  if (vote.margin < margin)
    return 'uncertain'

  return vote.label
}

/**
 * How many inputs one request may carry.
 *
 * Providers cap this: Aliyun's `text-embedding-v4` rejects a batch above ten with
 * `batch size is invalid`. A smaller request per batch costs a few extra round
 * trips and works everywhere, so the page never has to know the provider.
 */
export const embeddingBatchSize = 10

/**
 * Asks an OpenAI-compatible route for the vectors of several inputs.
 *
 * Inputs are sent in batches, in order, so a long sample set still costs a fixed
 * number of requests. The timeout applies to one batch: a whole run timing out
 * together would hide which batch stalled.
 */
export async function requestEmbeddings(
  endpoint: EmbeddingEndpoint,
  inputs: string[],
  options?: { timeoutMs?: number, batchSize?: number },
): Promise<number[][]> {
  const timeoutMs = options?.timeoutMs ?? 30_000
  const batchSize = Math.max(1, options?.batchSize ?? embeddingBatchSize)
  const vectors: number[][] = []

  for (let start = 0; start < inputs.length; start += batchSize) {
    const batch = inputs.slice(start, start + batchSize)
    const result = await requestEmbeddingBatch(endpoint, batch, timeoutMs)
    vectors.push(...result)
  }

  return vectors
}

async function requestEmbeddingBatch(endpoint: EmbeddingEndpoint, input: string[], timeoutMs: number): Promise<number[][]> {
  const request = embedMany({
    baseURL: endpoint.baseURL,
    model: endpoint.model,
    input,
    ...(endpoint.apiKey ? { apiKey: endpoint.apiKey } : {}),
  })

  // A dead route must end the comparison instead of hanging the page.
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Embedding request timed out after ${timeoutMs}ms`)), timeoutMs)
  })

  try {
    const result = await Promise.race([request, timeout])
    return result.embeddings
  }
  finally {
    if (timer)
      clearTimeout(timer)
  }
}

/** One labelled sample and the vote a stored reference set produced for it. */
export interface EmbeddingVoteRecord {
  id: string
  input: string
  expected: IntentDecisionLabel
  vote: EmbeddingVote
}

/** What one threshold does to a stored set of votes. */
export interface EmbeddingThresholdReport {
  margin: number
  medicalTotal: number
  chatTotal: number
  medicalRecall: number
  chatFalsePositiveRate: number
  /** Votes whose margin fell below the threshold; they are not a label. */
  uncertain: number
  misses: EmbeddingVoteRecord[]
  falsePositives: EmbeddingVoteRecord[]
}

/**
 * Scores stored votes at one threshold.
 *
 * Kept apart from the embedding request, so a threshold experiment costs no
 * network call and no re-embedding: the same votes are re-scored. A vote below
 * the margin counts as uncertain, which is neither a hit nor a wrong medical
 * answer, so it lowers recall without raising the false-positive rate.
 *
 * @example
 * evaluateEmbeddingVotes([{ id: 'med-01', input: '黄疸', expected: 'medical', vote }], { margin: 0.02 })
 * // => { medicalRecall: 1, chatFalsePositiveRate: 0, uncertain: 0, ... }
 */
export function evaluateEmbeddingVotes(
  records: readonly EmbeddingVoteRecord[],
  options: { margin: number },
): EmbeddingThresholdReport {
  const misses: EmbeddingVoteRecord[] = []
  const falsePositives: EmbeddingVoteRecord[] = []
  let medicalTotal = 0
  let medicalHits = 0
  let chatTotal = 0
  let uncertain = 0

  for (const record of records) {
    const outcome = decideEmbedding(record.vote, { margin: options.margin })
    if (outcome === 'uncertain')
      uncertain += 1

    if (record.expected === 'medical') {
      medicalTotal += 1
      if (outcome === 'medical')
        medicalHits += 1
      else
        misses.push(record)
    }
    else {
      chatTotal += 1
      if (outcome === 'medical')
        falsePositives.push(record)
    }
  }

  return {
    margin: options.margin,
    medicalTotal,
    chatTotal,
    medicalRecall: medicalTotal ? medicalHits / medicalTotal : 0,
    chatFalsePositiveRate: chatTotal ? falsePositives.length / chatTotal : 0,
    uncertain,
    misses,
    falsePositives,
  }
}
