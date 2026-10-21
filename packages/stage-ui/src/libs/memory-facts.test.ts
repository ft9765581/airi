import { describe, expect, it, vi } from 'vitest'

import { extractMemoryFacts, parseMemoryFacts, userTextFromTurn } from './memory-facts'

describe('parseMemoryFacts', () => {
  it('reads a fenced JSON array', () => {
    const facts = parseMemoryFacts('```json\n[{"scope":"user","content":"用户对花生过敏","importance":9}]\n```')

    expect(facts).toEqual([{
      scope: 'user',
      content: '用户对花生过敏',
      importance: 9,
    }])
  })

  it('returns no facts when the reply is not a JSON array', () => {
    expect(parseMemoryFacts('nothing worth storing')).toEqual([])
  })

  it('drops a fact that is too short and clamps importance', () => {
    const facts = parseMemoryFacts(JSON.stringify([
      { scope: 'user', content: '茶', importance: 5 },
      { scope: 'character', content: '这张角色卡答应下周提醒复查', importance: 40 },
      { scope: 'global', content: '这条不该留下', importance: 5 },
    ]))

    expect(facts).toEqual([{
      scope: 'character',
      content: '这张角色卡答应下周提醒复查',
      importance: 10,
    }])
  })
})

describe('userTextFromTurn', () => {
  it('reads the latest user text, including text parts', () => {
    const text = userTextFromTurn([
      { role: 'user', content: '第一句' },
      { role: 'assistant', content: '好的' },
      { role: 'user', content: [{ type: 'text', text: '我对花生过敏' }, { type: 'image', url: 'x' }] },
    ])

    expect(text).toBe('我对花生过敏')
  })
})

describe('extractMemoryFacts', () => {
  it('does not call the model when the user text is empty', async () => {
    const complete = vi.fn(async () => '[]')

    const facts = await extractMemoryFacts({
      userText: '   ',
      assistantText: '你好',
      complete,
    })

    expect(facts).toEqual([])
    expect(complete).not.toHaveBeenCalled()
  })

  it('returns the facts from the model reply', async () => {
    const complete = vi.fn(async () => '[{"scope":"user","content":"用户对花生过敏","importance":9}]')

    const facts = await extractMemoryFacts({
      userText: '我对花生过敏',
      assistantText: '我会记住。',
      complete,
    })

    expect(facts).toEqual([{
      scope: 'user',
      content: '用户对花生过敏',
      importance: 9,
    }])
    expect(complete).toHaveBeenCalledOnce()
  })
})
