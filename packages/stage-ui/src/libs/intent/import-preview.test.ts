import { describe, expect, it } from 'vitest'

import { previewSampleImport, sampleSignature } from './import-preview'

describe('sampleSignature', () => {
  it('ignores the label, because the label does not change the sentence', () => {
    const first = sampleSignature({ input: '宝宝黄疸怎么看' })
    const second = sampleSignature({ input: ' 宝宝黄疸怎么看 ' })

    expect(first).toBe(second)
  })

  it('keeps the earlier turns, so a follow-up is a different sample', () => {
    const bare = sampleSignature({ input: '现在还是这样' })
    const withTurn = sampleSignature({ input: '现在还是这样', context: [{ role: 'user', content: '大量出血' }] })

    expect(bare).not.toBe(withTurn)
  })
})

describe('previewSampleImport', () => {
  it('accepts a well-formed row', () => {
    const preview = previewSampleImport({
      rows: [{ input: '宝宝黄疸怎么看', group: 'medical-explicit', expected: 'medical' }],
    })

    expect(preview.issues).toEqual([])
    expect(preview.valid).toHaveLength(1)
    expect(preview.valid[0]).toMatchObject({ input: '宝宝黄疸怎么看', expected: 'medical' })
  })

  it('reports a missing message instead of writing an empty row', () => {
    const preview = previewSampleImport({ rows: [{ group: 'chitchat' }] })

    expect(preview.valid).toEqual([])
    expect(preview.issues[0]).toMatchObject({ index: 0, reason: 'input-missing' })
  })

  it('rejects an unknown group before the request', () => {
    const preview = previewSampleImport({ rows: [{ input: '你好', group: 'made-up' }] })

    expect(preview.issues[0]).toMatchObject({ index: 0, reason: 'group-unknown' })
  })

  it('rejects an unknown label', () => {
    const preview = previewSampleImport({ rows: [{ input: '你好', group: 'chitchat', expected: 'maybe' }] })

    expect(preview.issues[0]).toMatchObject({ index: 0, reason: 'label-unknown' })
  })

  it('rejects a context turn without a role or content', () => {
    const preview = previewSampleImport({
      rows: [{ input: '现在还是这样', group: 'medical-implicit', context: [{ role: 'system', content: 'x' }] }],
    })

    expect(preview.issues[0]).toMatchObject({ index: 0, reason: 'context-invalid' })
  })

  it('separates duplicates from failures', () => {
    const preview = previewSampleImport({
      rows: [
        { input: '宝宝黄疸怎么看', group: 'medical-explicit', expected: 'medical' },
        { input: '宝宝黄疸怎么看', group: 'medical-explicit', expected: 'chat' },
      ],
    })

    // A duplicate is a note, not a failure: the row is readable, just repeated.
    expect(preview.issues).toEqual([])
    expect(preview.duplicates).toHaveLength(1)
    expect(preview.valid).toHaveLength(1)
  })

  it('detects a row that already exists in the stored set', () => {
    const preview = previewSampleImport({
      rows: [{ input: '今天天气不错', group: 'chitchat' }],
      existing: [{ input: '今天天气不错' }],
    })

    expect(preview.duplicates[0]).toMatchObject({ index: 0, reason: 'duplicate' })
  })

  it('keeps the earlier turns of an accepted row', () => {
    const preview = previewSampleImport({
      rows: [{ input: '现在还是这样', group: 'medical-implicit', context: [{ role: 'assistant', content: '先观察出血量' }] }],
    })

    expect(preview.valid[0].context).toEqual([{ role: 'assistant', content: '先观察出血量' }])
  })
})
