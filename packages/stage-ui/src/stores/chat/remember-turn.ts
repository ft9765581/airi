import type { ChatProvider } from '@xsai-ext/providers/utils'

import type { MemoryTurnMessage } from '../../libs/memory-facts'

import { errorMessageFrom } from '@moeru/std'
import { generateText } from '@xsai/generate-text'
import { message } from '@xsai/utils-chat'

import { saveMemories } from '../../libs/memory-api'
import { extractMemoryFacts, userTextFromTurn } from '../../libs/memory-facts'
import { useAuthStore } from '../auth'
import { useAiriCardStore } from '../modules/airi-card'
import { useConsciousnessStore } from '../modules/consciousness'

/** How long fact extraction waits for the chat model. */
const extractTimeoutMs = 8_000

export interface RememberTurnInput {
  assistantText: string
  sessionMessages: readonly MemoryTurnMessage[]
}

async function completeWithActiveModel(request: { system: string, user: string }): Promise<string> {
  const consciousness = useConsciousnessStore()
  const providerId = consciousness.activeProvider
  const model = consciousness.activeModel
  if (!providerId || !model)
    return ''

  const chatProvider: ChatProvider = await consciousness.getChatProviderInstance(providerId)
  const result = await generateText({
    ...chatProvider.chat(model),
    messages: message.messages(
      message.system(request.system),
      message.user(request.user),
    ),
    abortSignal: AbortSignal.timeout(extractTimeoutMs),
    max_tokens: 400,
  })
  return result.text ?? ''
}

async function storeTurn(input: RememberTurnInput): Promise<void> {
  if (useAuthStore().userId === 'local')
    return

  const facts = await extractMemoryFacts({
    userText: userTextFromTurn(input.sessionMessages),
    assistantText: input.assistantText,
    complete: completeWithActiveModel,
  })
  if (!facts.length)
    return
  if (useAuthStore().userId === 'local')
    return

  const characterId = useAiriCardStore().activeCardId || 'default'
  await saveMemories(characterId, facts)
}

/**
 * Stores a few facts after one assistant turn.
 *
 * The write runs after the turn is already on screen. A model error or a
 * failed save does not change the chat.
 */
export function rememberTurn(input: RememberTurnInput): void {
  void storeTurn(input).catch((error: unknown) => {
    if (import.meta.env.DEV)
      console.warn('[long-term-memory] extract failed', errorMessageFrom(error))
  })
}
