export interface MemoryFactDraft {
  scope: 'user' | 'character'
  content: string
  importance: number
}

export interface MemoryTurnMessage {
  role: string
  content?: unknown
}

const MAX_FACTS = 3
const MAX_CONTENT_LENGTH = 500
const MIN_CONTENT_LENGTH = 4
const MAX_TURN_CHARACTERS = 2_000

const EXTRACTION_SYSTEM = [
  'You store durable facts from one conversation turn.',
  'Return a JSON array of at most 3 objects.',
  'Each object has scope, content, and importance.',
  'scope is "user" when the fact is about the person and any character should know it.',
  'scope is "character" when the fact is about this character and this person together.',
  'content is one short sentence in the language of the conversation.',
  'importance is an integer from 1 to 10. A name, allergy, or preference is 8 or more. A passing detail is 3 or less.',
  'Skip greetings, questions, and instructions to the character.',
  'When nothing is worth storing, return [].',
  'Return only the JSON array.',
].join('\n')

function clip(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length <= MAX_TURN_CHARACTERS)
    return trimmed
  return trimmed.slice(0, MAX_TURN_CHARACTERS)
}

function textFromContent(content: unknown): string {
  if (typeof content === 'string')
    return content
  if (!Array.isArray(content))
    return ''

  const lines: string[] = []
  for (const part of content) {
    if (part == null || typeof part !== 'object')
      continue
    if (!('type' in part) || part.type !== 'text')
      continue
    if (!('text' in part) || typeof part.text !== 'string')
      continue
    lines.push(part.text)
  }
  return lines.join('\n')
}

/**
 * Reads the latest user text from the messages of one turn.
 *
 * @example
 * userTextFromTurn([{ role: 'user', content: '我对花生过敏' }, { role: 'assistant', content: '我会记住。' }])
 * // => '我对花生过敏'
 */
export function userTextFromTurn(messages: readonly MemoryTurnMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.role !== 'user')
      continue
    return textFromContent(message.content).trim()
  }
  return ''
}

function unwrapFence(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed.startsWith('```'))
    return trimmed

  const firstLineEnd = trimmed.indexOf('\n')
  const lastFence = trimmed.lastIndexOf('```')
  if (firstLineEnd < 0 || lastFence <= firstLineEnd)
    return trimmed

  return trimmed.slice(firstLineEnd + 1, lastFence).trim()
}

/**
 * Reads fact objects from a model reply.
 *
 * Text around the JSON array is ignored. A reply that is not a JSON array
 * returns no facts.
 *
 * @example
 * parseMemoryFacts('```json\n[{"scope":"user","content":"用户对花生过敏","importance":9}]\n```')
 * // => [{ scope: 'user', content: '用户对花生过敏', importance: 9 }]
 */
export function parseMemoryFacts(raw: string): MemoryFactDraft[] {
  const payload = unwrapFence(raw)
  const start = payload.indexOf('[')
  const end = payload.lastIndexOf(']')
  if (start < 0 || end <= start)
    return []

  let parsed: unknown
  try {
    parsed = JSON.parse(payload.slice(start, end + 1))
  }
  catch {
    return []
  }
  if (!Array.isArray(parsed))
    return []

  const facts: MemoryFactDraft[] = []
  for (const item of parsed) {
    if (facts.length >= MAX_FACTS)
      break
    if (item == null || typeof item !== 'object')
      continue

    const record = item as { scope?: unknown, content?: unknown, importance?: unknown }
    const scope = record.scope === 'user' || record.scope === 'character' ? record.scope : null
    const content = typeof record.content === 'string' ? record.content.trim().replace(/\s+/g, ' ') : ''
    if (!scope || content.length < MIN_CONTENT_LENGTH)
      continue

    const importanceRaw = typeof record.importance === 'number' ? record.importance : 5
    const importance = Math.min(10, Math.max(1, Math.round(importanceRaw)))
    facts.push({
      scope,
      content: content.slice(0, MAX_CONTENT_LENGTH),
      importance,
    })
  }
  return facts
}

/**
 * Asks the active chat model for a few durable facts from one turn.
 *
 * An empty side of the turn returns no facts and does not call the model.
 * The caller supplies the model call. A bad reply returns no facts.
 */
export async function extractMemoryFacts(input: {
  userText: string
  assistantText: string
  complete: (request: { system: string, user: string }) => Promise<string>
}): Promise<MemoryFactDraft[]> {
  const userText = input.userText.trim()
  const assistantText = input.assistantText.trim()
  if (!userText || !assistantText)
    return []

  const raw = await input.complete({
    system: EXTRACTION_SYSTEM,
    user: ['User:', clip(userText), '', 'Assistant:', clip(assistantText)].join('\n'),
  })
  return parseMemoryFacts(raw)
}
