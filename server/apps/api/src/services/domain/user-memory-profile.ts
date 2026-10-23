import type { MemoryCategory } from './memory-category'

import { PROFILE_CATEGORY_HEADING } from './memory-category'
import { memoryOverlap, SUPERSEDE_SCORE } from './user-memory-match'

/** The profile field refuses text longer than this. */
const MAX_PROFILE_LENGTH = 20_000

export interface ProfileMemoryFact {
  id: string
  category: MemoryCategory
  content: string
  createdAt: number
}

const HEADINGS = new Set(Object.values(PROFILE_CATEGORY_HEADING))

function isHeading(line: string): boolean {
  return HEADINGS.has(line.trim())
}

function appendUnderHeading(lines: string[], category: MemoryCategory, content: string): boolean {
  const heading = PROFILE_CATEGORY_HEADING[category]
  const next = lines.slice()
  const headingIndex = next.findIndex(line => line.trim() === heading)

  if (headingIndex < 0) {
    if (next.length === 1 && next[0] === '') {
      next.splice(0, 1, heading, content)
    }
    else {
      if (next.length > 0 && next[next.length - 1] !== '')
        next.push('')
      next.push(heading, content)
    }
  }
  else {
    let insertAt = headingIndex + 1
    while (insertAt < next.length && !isHeading(next[insertAt] ?? ''))
      insertAt += 1
    while (insertAt > headingIndex + 1 && (next[insertAt - 1] ?? '').trim() === '')
      insertAt -= 1
    next.splice(insertAt, 0, content)
  }

  if (next.join('\n').length > MAX_PROFILE_LENGTH)
    return false

  lines.splice(0, lines.length, ...next)
  return true
}

/**
 * Folds facts into the profile text.
 *
 * A fact that overlaps an existing line replaces that line. A newer fact keeps
 * the line when two facts overlap it. A fact with no overlapping line is
 * appended under its category heading. Handwritten lines that do not overlap
 * stay where they are. Facts that do not fit in the profile length are left
 * out of `appliedIds` so a later rollup can try again.
 */
export function mergeProfileWithMemories(profile: string, facts: readonly ProfileMemoryFact[]): { content: string, appliedIds: string[] } {
  const lines = profile.replace(/\r\n/g, '\n').split('\n')
  const claimed = new Set<number>()
  const appliedIds: string[] = []
  const ordered = [...facts].sort((left, right) => right.createdAt - left.createdAt || left.id.localeCompare(right.id))

  for (const fact of ordered) {
    const content = fact.content.trim()
    if (content.length < 4)
      continue

    let bestIndex = -1
    let bestScore = 0
    for (let index = 0; index < lines.length; index += 1) {
      const line = (lines[index] ?? '').trim()
      if (!line || isHeading(line))
        continue
      const score = memoryOverlap(content, line)
      if (score > bestScore) {
        bestScore = score
        bestIndex = index
      }
    }

    if (bestIndex >= 0 && bestScore >= SUPERSEDE_SCORE) {
      if (!claimed.has(bestIndex)) {
        const replaced = lines.slice()
        replaced[bestIndex] = content
        if (replaced.join('\n').length > MAX_PROFILE_LENGTH)
          continue
        lines[bestIndex] = content
        claimed.add(bestIndex)
      }
      appliedIds.push(fact.id)
      continue
    }

    if (!appendUnderHeading(lines, fact.category, content))
      continue
    appliedIds.push(fact.id)
  }

  return {
    content: lines.join('\n'),
    appliedIds,
  }
}
