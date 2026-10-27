/**
 * Checks a pasted sample batch before anything is written.
 *
 * The server already rejects a malformed batch, but a rejection after the request
 * leaves the page with nothing to read: which row failed, and why. This module
 * runs the same checks on the text the person pasted, so the page can show the
 * problem next to the row (intent-routing.md §7.6, 导入预校验).
 */

/** The groups the server accepts, mirrored so a typo is caught before the request. */
export const importableGroups = [
  'medical-explicit',
  'medical-implicit',
  'medical-knowledge',
  'hospital-process',
  'chitchat',
  'short-reply',
  'asr-noise',
] as const

export type ImportableGroup = typeof importableGroups[number]

/** One row as it may be written. Only the fields the import needs. */
export interface ImportDraft {
  input: string
  context?: { role: 'user' | 'assistant', content: string }[]
  group: ImportableGroup
  expected?: 'medical' | 'chat'
  source?: string
}

/** Why one row cannot be written, or `duplicate` when it repeats an earlier one. */
export interface ImportIssue {
  index: number
  reason: 'input-missing' | 'group-unknown' | 'label-unknown' | 'context-invalid' | 'duplicate'
  detail: string
}

/** What a paste would do, before the page asks for confirmation. */
export interface ImportPreview {
  total: number
  /** Rows that pass every check, duplicates included. */
  valid: ImportDraft[]
  /** Rows a person must fix; their presence blocks the write. */
  issues: ImportIssue[]
  /** Rows that repeat another row or an existing sample. */
  duplicates: ImportIssue[]
  /** Message and context signature, so a page can show what collides. */
  signatures: string[]
}

/**
 * A stable signature of what makes two samples the same.
 *
 * The message and its earlier turns decide meaning; the label does not, so the
 * same sentence labelled twice is still a duplicate.
 *
 * @example
 * sampleSignature({ input: '现在还是这样', context: [{ role: 'user', content: '大量出血' }], group: 'medical-implicit' })
 * // => '现在还是这样||user:大量出血'
 */
export function sampleSignature(sample: { input: string, context?: readonly { role: string, content: string }[] | null }): string {
  const turns = (sample.context ?? []).map(turn => `${turn.role}:${turn.content.trim()}`).join('|')
  return `${sample.input.trim()}||${turns}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Checks every pasted row and separates the failures from the duplicates.
 *
 * Duplicates are not failures: the same sentence twice is a data-quality note a
 * person decides about, so they travel separately and the page can offer to skip
 * them.
 */
export function previewSampleImport(input: {
  rows: unknown[]
  existing?: { input: string, context?: readonly { role: string, content: string }[] | null }[]
}): ImportPreview {
  const issues: ImportIssue[] = []
  const duplicates: ImportIssue[] = []
  const valid: ImportDraft[] = []
  const seen = new Set((input.existing ?? []).map(sample => sampleSignature(sample)))
  const signatures: string[] = []

  for (const [index, row] of input.rows.entries()) {
    if (!isRecord(row)) {
      issues.push({ index, reason: 'input-missing', detail: '不是一个对象' })
      continue
    }

    const text = typeof row.input === 'string' ? row.input.trim() : ''
    if (!text) {
      issues.push({ index, reason: 'input-missing', detail: '缺少 input，或它是空的' })
      continue
    }

    const group = typeof row.group === 'string' ? row.group : ''
    if (!importableGroups.includes(group as ImportableGroup)) {
      issues.push({ index, reason: 'group-unknown', detail: `未知分组：${group || '（空）'}` })
      continue
    }

    if (row.expected !== undefined && row.expected !== 'medical' && row.expected !== 'chat') {
      issues.push({ index, reason: 'label-unknown', detail: `标答只能是 medical 或 chat：${String(row.expected)}` })
      continue
    }

    let context: ImportDraft['context']
    if (row.context !== undefined) {
      if (!Array.isArray(row.context) || row.context.length > 10) {
        issues.push({ index, reason: 'context-invalid', detail: 'context 必须是数组，最多 10 轮' })
        continue
      }

      const turns: NonNullable<ImportDraft['context']> = []
      let broken = false
      for (const turn of row.context) {
        if (!isRecord(turn) || (turn.role !== 'user' && turn.role !== 'assistant') || typeof turn.content !== 'string' || !turn.content.trim()) {
          broken = true
          break
        }
        turns.push({ role: turn.role, content: turn.content.trim() })
      }

      if (broken) {
        issues.push({ index, reason: 'context-invalid', detail: '每一轮都要有 role（user\uFF0Fassistant）和非空 content' })
        continue
      }

      context = turns
    }

    const draft: ImportDraft = {
      input: text,
      group: group as ImportableGroup,
      ...(context?.length ? { context } : {}),
      ...(row.expected ? { expected: row.expected as 'medical' | 'chat' } : {}),
      ...(typeof row.source === 'string' && row.source.trim() ? { source: row.source.trim() } : {}),
    }

    const signature = sampleSignature(draft)
    signatures.push(signature)
    if (seen.has(signature)) {
      duplicates.push({ index, reason: 'duplicate', detail: '与已有样本或本批前面的行重复' })
      continue
    }

    seen.add(signature)
    valid.push(draft)
  }

  return {
    total: input.rows.length,
    valid,
    issues,
    duplicates,
    signatures,
  }
}
