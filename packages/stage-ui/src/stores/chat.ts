import type { ChatOrchestratorRuntimeState, ChatOrchestratorSendOptions, StreamEvent, StreamOptions, TurnRoute, TurnRouteResult } from '@proj-airi/core-agent'
import type { WebSocketEventInputs } from '@proj-airi/server-sdk'
import type { ChatProvider } from '@xsai-ext/providers/utils'
import type { Message } from '@xsai/shared-chat'
import type { SyncedPiniaRuntime } from 'pinia-plugin-synced'

import type { ClassifyHistoryTurn, IntentModelOptions } from '../libs/intent/classify-model'
import type { ChatHistoryItem, ChatToolReference, StreamingAssistantMessage } from '../types/chat'
import type { ToolCallRerunPayload } from './tool-call-rerun'

import { errorMessageFrom } from '@moeru/std'
import { createChatOrchestratorRuntime } from '@proj-airi/core-agent'
import { IOAttributes, IOEvents, IOSpanNames, IOSubsystems } from '@proj-airi/stage-shared'
import { nanoid } from 'nanoid'
import { defineStore, storeToRefs } from 'pinia'
import { shallowRef, toRaw } from 'vue'

import { getConversationAnalyticsSurface } from '../composables'
import { activeTurnSpan, startSpan } from '../composables/use-io-tracer'
import {
  AIRI_CHAT_APP_SURFACE_HEADER,
  AIRI_CHAT_ROUND_ID_HEADER,
  AIRI_CHAT_SESSION_ID_HEADER,
} from '../libs/analytics-headers'
import { createChatAnalyticsHooks, getProviderMode } from '../libs/analytics/events/chat'
import { extractMessageText, isCloudSyncableMessage } from '../libs/chat-sync'
import { classifyMessage } from '../libs/intent/classify'
import { classifyRules, inheritedRedFlag } from '../libs/intent/classify-rules'
import { allowsMedicalGeneration, parseMedicalGenerationMode } from '../libs/intent/medical-generation'
import { summarizePrompt } from '../libs/intent/medical-prompt'
import { failedTurnReply, routeMedicalTurn } from '../libs/intent/turn'
import { useLLM } from './ai/chat-llm/llm'
import { resolveLlmTools } from './ai/chat-llm/tool-resolver'
import { useLlmToolsStore } from './ai/chat-llm/tools'
import { useLlmToolsetPromptsStore } from './ai/chat-llm/toolset-prompts'
import { createKnowledgeBaseContext, createLongTermMemoryContext, createMinecraftContext, createUserProfileContext, retrieveKnowledgeBaseContext } from './chat/context-providers'
import { useChatContextStore } from './chat/context-store'
import { rememberTurn } from './chat/remember-turn'
import { useChatSessionStore } from './chat/session-store'
import { useChatStreamStore } from './chat/stream-store'
import { useContextObservabilityStore } from './devtools/context-observability'
import { useAiriCardStore } from './modules/airi-card'
import { useAutonomousArtistryStore } from './modules/artistry-autonomous'
import { useConsciousnessStore } from './modules/consciousness'
import { useWebSearchStore } from './modules/web-search'
import { useProviderStore } from './providers/provider'
import { executeToolCallRerun } from './tool-call-rerun'

interface ForkOptions {
  fromSessionId?: string
  atIndex?: number
  reason?: string
  hidden?: boolean
}

/** A serializable chat request that any application context can send to the leader. */
export interface ChatSendPayload {
  /** Image attachments for the new user message. */
  attachments?: { type: 'image', data: string, mimeType: string }[]
  /** Original input metadata for chat hooks and telemetry. */
  input?: WebSocketEventInputs
  /** Session that owns the new turn. */
  sessionId: string
  /** User text for the new turn. */
  text: string
  /** Request-specific tools selected by their model-facing names. */
  tools?: ChatToolReference[]
}

/** The durable messages appended while one chat request executes. */
export interface ChatSendResult {
  messages: ChatHistoryItem[]
  sessionId: string
}

/** Identifies one stored message whose user turn must run again. */
export interface ChatRetryPayload {
  index: number
  sessionId: string
  tools?: ChatToolReference[]
}

/** Identifies one stored tool call that must run again in the leader. */
export interface ChatToolCallRerunPayload extends Omit<ToolCallRerunPayload, 'sessionId' | 'toolset'> {
  sessionId: string
}

type ProviderHistoryMessage = Exclude<ChatHistoryItem, { role: 'error' }>

function toProviderHistory(messages: ChatHistoryItem[]): Message[] {
  return messages.filter((message): message is ProviderHistoryMessage => message.role !== 'error')
}

function isTextDelta(event: StreamEvent): event is Extract<StreamEvent, { type: 'text-delta' }> {
  return event.type === 'text-delta'
}

function retryTextFrom(message: ChatHistoryItem | undefined): string | null {
  if (!message || message.role !== 'user')
    return null

  if (typeof message.content === 'string') {
    const text = message.content.trim()
    return text || null
  }

  if (!Array.isArray(message.content))
    return null

  const text = message.content.reduce<string[]>((texts, part) => {
    if (part.type !== 'text')
      return texts

    const value = part.text?.trim()
    if (value)
      texts.push(value)

    return texts
  }, []).join('\n\n')

  return text || null
}

function retrySourceIndexFrom(messages: ChatHistoryItem[], index: number): number {
  const targetMessage = messages[index]
  if (!targetMessage)
    return -1

  if (targetMessage.role === 'user')
    return index

  if (targetMessage.role !== 'assistant' && targetMessage.role !== 'error')
    return -1

  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    if (messages[cursor]?.role === 'user')
      return cursor
  }

  return -1
}

export type { QueuedSendSnapshot } from '@proj-airi/core-agent'

export const useChatStore = defineStore('chat', () => {
  const llmStore = useLLM()
  const llmToolsStore = useLlmToolsStore()
  const llmToolsetPromptsStore = useLlmToolsetPromptsStore()
  // Instantiate the web-search store eagerly so its `configured` watcher registers
  // WEB_SEARCH_TOOLSET_PROMPT before getSystemPromptSupplement is read below. The
  // tool resolver that would otherwise be the first to create this store runs after
  // the system prompt is composed, which would expose web_search on the first turn
  // without its paired prompt-injection defense.
  useWebSearchStore()
  const consciousnessStore = useConsciousnessStore()
  const artistryAutonomousStore = useAutonomousArtistryStore()
  const { activeModel, activeProvider } = storeToRefs(consciousnessStore)
  const chatSession = useChatSessionStore()
  const chatStream = useChatStreamStore()
  const chatContext = useChatContextStore()
  const cardStore = useAiriCardStore()
  const contextObservability = useContextObservabilityStore()
  const { activeSessionId } = storeToRefs(chatSession)
  const { streamingMessage } = storeToRefs(chatStream)

  const sending = shallowRef(false)
  /**
   * Whether this build may generate medical answers.
   *
   * The card opt-in says a card is willing; this switch says the deployment
   * evaluated the classifier. It defaults to `off`, so an unevaluated build
   * keeps the fixed reply.
   */
  const medicalGenerationEnabled = allowsMedicalGeneration(
    parseMedicalGenerationMode(import.meta.env.VITE_MEDICAL_GENERATION),
    { isDevelopment: import.meta.env.DEV },
  )

  /**
   * The branch of the turn in flight per session.
   *
   * A failed medical generation ends with fixed copy instead of an error bubble,
   * which needs to know what the turn was. `routeTurn` writes it, `executeSend`
   * clears it before the next attempt, so a stale branch cannot colour a later
   * failure.
   */
  const lastRouteBySession = new Map<string, TurnRoute>()
  const activeSendSessionId = shallowRef<string>()
  const activeStreamingMessage = shallowRef<StreamingAssistantMessage>()
  const pendingQueuedSendCount = shallowRef(0)
  let ownedActiveTurnSpan: typeof activeTurnSpan.value
  let stopLeadershipListener: (() => void) | undefined
  const analyticsHooks = createChatAnalyticsHooks({
    getSessionMessages: sessionId => chatSession.getSessionMessages(sessionId),
  })

  /**
   * Initializes chat state and binds local consumers to synchronized leadership.
   * A promoted renderer restarts the leader-owned cloud consumer.
   */
  async function initialize(syncedPinia: SyncedPiniaRuntime) {
    stopLeadershipListener ??= syncedPinia.onLeadershipChange((isLeader) => {
      if (!isLeader) {
        chatSession.dispose()
        return
      }

      void chatSession.ensureCurrentSession().catch((error) => {
        console.error('[chat] Failed to start chat consumers after leader promotion:', error)
      })
    })

    await chatSession.initialize()
  }

  /** Stops chat consumers that belong to this window. */
  function dispose() {
    stopLeadershipListener?.()
    stopLeadershipListener = undefined
    chatSession.dispose()
  }

  async function streamWithStageAdapters(
    model: string,
    chatProvider: ChatProvider,
    messages: Message[],
    options?: StreamOptions,
  ) {
    let llmTextLength = 0
    let llmOutputChunkCount = 0
    const llmOutputChunkLengths: number[] = []
    const headers = { ...options?.headers }
    if (getProviderMode(activeProvider.value) === 'official' && options?.requestCorrelation) {
      headers[AIRI_CHAT_SESSION_ID_HEADER] = options.requestCorrelation.conversationId
      headers[AIRI_CHAT_ROUND_ID_HEADER] = options.requestCorrelation.roundId
      headers[AIRI_CHAT_APP_SURFACE_HEADER] = getConversationAnalyticsSurface()
    }

    const hadExistingTurn = !!activeTurnSpan.value
    if (!hadExistingTurn) {
      const turnSpan = startSpan(IOSpanNames.InteractionTurn)
      activeTurnSpan.value = turnSpan
      ownedActiveTurnSpan = turnSpan
    }

    const llmSpan = startSpan(IOSpanNames.LLMInference, activeTurnSpan.value, {
      [IOAttributes.Subsystem]: IOSubsystems.LLM,
      [IOAttributes.GenAIRequestModel]: model,
      [IOAttributes.LLMInputMessageCount]: messages.length,
      [IOAttributes.LLMInputUserMessageCount]: messages.filter(message => message.role === 'user').length,
      [IOAttributes.TurnId]: options?.requestCorrelation?.roundId ?? '',
    })
    llmSpan.setAttribute(IOAttributes.LLMInputMessageRoles, messages.map(message => message.role))
    const llmRequestTs = performance.now()
    let llmFirstTokenEmitted = false

    try {
      await llmStore.stream(model, chatProvider, messages, {
        ...options,
        headers,
        onStreamEvent: async (event: StreamEvent) => {
          if (isTextDelta(event)) {
            llmOutputChunkCount += 1
            llmOutputChunkLengths.push(event.text.length)
            if (!llmFirstTokenEmitted) {
              llmFirstTokenEmitted = true
              llmSpan.addEvent(IOEvents.LLMFirstToken, {
                [IOAttributes.LLM_TTFT]: performance.now() - llmRequestTs,
              })
            }
            llmTextLength += event.text.length
          }

          await options?.onStreamEvent?.(event)
        },
      })
    }
    finally {
      llmSpan.setAttribute(IOAttributes.LLMOutputChunkCount, llmOutputChunkCount)
      llmSpan.setAttribute(IOAttributes.LLMOutputChunkLengths, llmOutputChunkLengths)
      llmSpan.setAttribute(IOAttributes.LLMTextLength, llmTextLength)
      llmSpan.end()
    }
  }

  function syncRuntimeState(state: ChatOrchestratorRuntimeState) {
    sending.value = state.sending
    activeSendSessionId.value = state.activeSendSessionId
    activeStreamingMessage.value = state.activeStreamingMessage
    pendingQueuedSendCount.value = state.pendingQueuedSendCount
  }

  function settleOwnedActiveTurnSpan() {
    if (!ownedActiveTurnSpan)
      return

    ownedActiveTurnSpan.end()
    if (activeTurnSpan.value === ownedActiveTurnSpan)
      activeTurnSpan.value = undefined
    ownedActiveTurnSpan = undefined
  }

  const runtime = createChatOrchestratorRuntime({
    session: {
      ensureSession: sessionId => chatSession.ensureSession(sessionId),
      getSessionMessages: sessionId => chatSession.getSessionMessages(sessionId).map(message => toRaw(message)),
      appendSessionMessage: (sessionId, message) => chatSession.appendSessionMessage(sessionId, message),
      getSessionGeneration: sessionId => chatSession.getSessionGeneration(sessionId),
    },
    context: {
      ingest: envelope => chatContext.ingestContextMessage(envelope),
      snapshot: () => chatContext.getContextsSnapshot(),
    },
    foregroundStream: {
      patch: (message) => {
        streamingMessage.value = message
      },
      reset: () => {
        streamingMessage.value = { role: 'assistant', content: '', slices: [], tool_results: [] }
      },
    },
    llm: {
      stream: streamWithStageAdapters,
    },
    getActiveSessionId: () => activeSessionId.value,
    getActiveProvider: () => activeProvider.value,
    getSystemPromptSupplement: () => llmToolsetPromptsStore.activeToolsetPrompt,
    routeTurn,
    runtimeContextProviders: [
      createMinecraftContext,
      createUserProfileContext,
      createLongTermMemoryContext,
      createKnowledgeBaseContext,
    ],
    createId: nanoid,
    unwrapMessage: message => toRaw(message),
    onStateChange: syncRuntimeState,
    onSendSettled: settleOwnedActiveTurnSpan,
    ...analyticsHooks,
    onLifecycle: record => contextObservability.recordLifecycle(record),
    onPromptProjection: payload => contextObservability.capturePromptProjection(payload),
    onUserMessageAppended: ({ sessionId, message, messageText, source, model, provider, roundId, turnIndex }) => {
      analyticsHooks.onUserMessageAppended?.({
        sessionId,
        message,
        messageText,
        source,
        model,
        provider,
        roundId,
        turnIndex,
      })
      if (isCloudSyncableMessage(message)) {
        void chatSession.pushMessageToCloud(sessionId, {
          id: message.id,
          role: 'user',
          content: messageText,
        })
      }
    },
    onAssistantMessageAppended: ({ sessionId, message }) => {
      if (isCloudSyncableMessage(message) && message.id) {
        void chatSession.pushMessageToCloud(sessionId, {
          id: message.id,
          role: 'assistant',
          content: extractMessageText(message),
        })
      }
    },
    onUserTurnReady: ({ sessionId, messageText, sessionMessages }) => {
      // A routed-away turn belongs to the medical branch, not to the ordinary
      // chat side effects. Starting the autonomous artistry task here would let a
      // medical question paint on the stage.
      if (isRoutedAwayFromChat(sessionId))
        return

      const autonomousTarget = cardStore.activeCard?.extensions?.airi?.modules?.artistry?.autonomousTarget || 'user'
      if (autonomousTarget === 'user')
        void artistryAutonomousStore.runArtistTask(messageText, toProviderHistory(sessionMessages))
    },
    onAssistantTurnReady: ({ sessionId, messageText, sessionMessages }) => {
      // The ordinary long-term memory and the autonomous task both describe what
      // this character talks about in chat. A medical answer is not that.
      if (isRoutedAwayFromChat(sessionId))
        return

      const artistry = cardStore.activeCard?.extensions?.airi?.modules?.artistry
      if (artistry?.autonomousEnabled && artistry?.autonomousTarget === 'assistant')
        void artistryAutonomousStore.runArtistTask(messageText, toProviderHistory(sessionMessages))
      rememberTurn({ assistantText: messageText, sessionMessages })
    },
  })

  /**
   * Resolves the chat provider for one turn that reaches the model.
   *
   * It runs after the router decided the branch, so an emergency or a fixed
   * reply still works on a deployment that has no provider configured.
   */
  async function resolveActiveChat(): Promise<{ model: string, chatProvider: ChatProvider }> {
    const providerId = activeProvider.value
    const model = activeModel.value
    if (!providerId || !model)
      throw new Error('No active chat provider or model configured')

    const chatProvider = await consciousnessStore.getChatProviderInstance(providerId)
    if (!chatProvider)
      throw new Error(`Failed to resolve chat provider "${providerId}"`)

    return { model, chatProvider }
  }

  /**
   * Classifies one turn for routing.
   *
   * The request matches the one the evaluation page sends: reasoning off,
   * because a classifier that thinks can spend its whole output budget before it
   * writes the label. With no provider the classifier degrades, and the router
   * turns that into the fallback branch instead of an error.
   */
  async function classifyTurnIntent(message: string, history: ChatHistoryItem[]) {
    const providerId = activeProvider.value
    const model = activeModel.value
    const turns: ClassifyHistoryTurn[] = history
      .filter(item => item.role === 'user' || item.role === 'assistant')
      .slice(-2)
      .map(item => ({
        role: item.role === 'user' ? 'user' as const : 'assistant' as const,
        content: extractMessageText(item),
      }))

    let classifier: IntentModelOptions | undefined
    if (providerId && model) {
      try {
        // The provider store is read here, not at setup: a turn that never
        // reaches the classifier must not pay for it, and the contract tests run
        // without a DOM.
        const providerStore = useProviderStore()
        const provider = await providerStore.getChatProviderInstance(providerId, { reasoning: 'disabled' })
        classifier = { request: provider.chat(model) }
      }
      catch {
        // A provider that cannot be built is a classifier failure. The caller
        // records it as a failure and answers with fixed copy.
        classifier = undefined
      }
    }

    const outcome = await classifyMessage({ message, mode: 'model', history: turns, model: classifier })
    if (outcome.mode !== 'model')
      throw new Error('The model classifier answered in another mode')

    return outcome.decision
  }

  /**
   * Decides the branch of one dequeued turn.
   *
   * The rules always run: urgency is a rule decision and the rules are free. The
   * model classifier runs only when this build may generate medical answers, so
   * the default deployment adds no request to any turn.
   */
  async function routeTurn({ sessionId, message, history }: { sessionId: string, message: string, history: ChatHistoryItem[] }): Promise<TurnRouteResult | undefined> {
    // The turn immediately before this one is the only place a danger signal can
    // carry over from: an alarm raised earlier was already answered. Judged
    // alone, "现在还是这样" carries no danger word, so without this the reader
    // would get a consultation answer instead of the emergency instruction.
    const previousUserTurn = history.filter(item => item.role === 'user').slice(-1)[0]
    const inherited = inheritedRedFlag(message, previousUserTurn ? extractMessageText(previousUserTurn) : undefined)
    const rules = inherited ?? classifyRules(message)

    const result = await routeMedicalTurn({
      rules,
      classify: () => classifyTurnIntent(message, history),
      agent: cardStore.activeCard?.extensions?.airi?.agents?.medical,
      allowGeneration: medicalGenerationEnabled,
      // A medical turn is isolated, so it cannot use the runtime providers. It
      // asks the medical-scoped knowledge bases here instead, and only after the
      // router decided this turn really generates an answer.
      retrieveContext: () => retrieveKnowledgeBaseContext(message, 'medical'),
    })

    // Kept per session so a failed generation can end with the copy that fits
    // the branch instead of an error bubble.
    lastRouteBySession.set(sessionId, result.route)

    // One metadata line per turn. The chat badge arrives in C2, so until then
    // this is how a tester sees which branch answered: `answer: model` means the
    // consultation model wrote the reply, `fixed` means fixed copy. No message
    // text reaches the console.
    console.info('[medical-consultation] route', {
      kind: result.route.kind,
      reason: result.route.reason,
      answer: result.reply ? 'fixed' : 'model',
      prompt: result.systemPrompt ? summarizePrompt(result.systemPrompt) : undefined,
    })

    return result
  }

  /** True when this turn took a branch other than ordinary chat. */
  function isRoutedAwayFromChat(sessionId: string) {
    const kind = lastRouteBySession.get(sessionId)?.kind
    return kind === 'medical' || kind === 'urgent' || kind === 'fallback'
  }

  async function ingest(
    sendingMessage: string,
    options?: ChatOrchestratorSendOptions,
    targetSessionId?: string,
  ) {
    const sessionId = targetSessionId ?? activeSessionId.value
    try {
      return await runtime.ingest(sendingMessage, options ?? { resolveChat: resolveActiveChat }, sessionId)
    }
    catch (error) {
      // The voice pipeline and the devtools playground enter here, so this path
      // needs the same failure handling as `send`.
      if (handleSendFailure(sessionId, error))
        return

      throw error
    }
  }

  function collectToolReferences(sessionId: string, selectedTools: ChatToolReference[] = []): ChatToolReference[] {
    const names = new Set<string>()

    for (const message of chatSession.getSessionMessages(sessionId)) {
      for (const tool of message.tools ?? [])
        names.add(tool.name)
    }

    for (const tool of selectedTools)
      names.add(tool.name)

    return [...names].map(name => ({ name }))
  }

  function appendSendError(sessionId: string, error: unknown) {
    if (!chatSession.getSessionMessagesIfLoaded(sessionId))
      return

    chatSession.appendSessionMessage(sessionId, {
      role: 'error',
      content: errorMessageFrom(error) ?? 'Unknown chat operation failure',
    })
  }

  /**
   * The one failure path for a turn, whatever entry it came from.
   *
   * A routed medical turn ends with the fixed reply, because a failed
   * consultation is still something the reader can act on. Every other branch
   * keeps the error message it has always shown.
   *
   * @returns the reply written, or undefined when the caller must rethrow
   */
  function handleSendFailure(sessionId: string, error: unknown): ChatSendResult | undefined {
    const reply = appendTurnFailureReply(sessionId, error)
    if (reply)
      return reply

    appendSendError(sessionId, error)
    return undefined
  }

  /**
   * Ends a failed medical turn with the fixed reply instead of an error bubble.
   *
   * A failed consultation is still an answer the user can act on, and the reason
   * stays in telemetry. Returns undefined for every other branch, so those keep
   * the error message.
   */
  function appendTurnFailureReply(sessionId: string, error: unknown): ChatSendResult | undefined {
    const route = lastRouteBySession.get(sessionId)
    const reply = failedTurnReply(route)
    if (!reply || !chatSession.getSessionMessagesIfLoaded(sessionId))
      return undefined

    const message: StreamingAssistantMessage = {
      role: 'assistant',
      content: reply,
      slices: [],
      tool_results: [],
      createdAt: Date.now(),
      id: nanoid(),
      route,
    }
    chatSession.appendSessionMessage(sessionId, message)

    // Type and length only. The decision text never reaches the console.
    console.warn('[medical-consultation] generation failed, wrote the fixed reply', errorMessageFrom(error)?.slice(0, 120))

    return { messages: [structuredClone(toRaw(message))], sessionId }
  }

  async function executeSend(payload: ChatSendPayload): Promise<ChatSendResult> {
    // A branch left by an earlier attempt must not colour this one.
    lastRouteBySession.delete(payload.sessionId)

    if (!await chatSession.loadSession(payload.sessionId))
      throw new Error('Failed to load the target chat session')

    const messageCount = chatSession.getSessionMessages(payload.sessionId).length

    // The provider is resolved inside the queue, after the router decided the
    // branch, so an emergency answer or a fixed reply needs no model at all.
    await runtime.ingest(payload.text, {
      resolveChat: resolveActiveChat,
      attachments: payload.attachments,
      input: payload.input,
      toolReferences: payload.tools,
      // Resolve this function after the request reaches the per-session queue.
      // The history then contains tool names from every earlier queued turn.
      tools: async () => {
        const references = collectToolReferences(payload.sessionId, payload.tools)
        return llmToolsStore.getToolsByNames(...references.map(tool => tool.name))
      },
    }, payload.sessionId)

    const completedMessages = chatSession.getSessionMessagesIfLoaded(payload.sessionId)
    if (!completedMessages)
      throw new Error('Chat session was removed before send completed')

    return {
      messages: completedMessages
        .slice(messageCount)
        .map(message => structuredClone(toRaw(message))),
      sessionId: payload.sessionId,
    }
  }

  /** Sends one serializable chat request through the elected leader. */
  async function send(payload: ChatSendPayload): Promise<ChatSendResult> {
    try {
      return await executeSend(payload)
    }
    catch (error) {
      const failureReply = handleSendFailure(payload.sessionId, error)
      if (failureReply)
        return failureReply

      throw error
    }
  }

  /** Replaces one stored turn with a new execution of its user message. */
  async function retry(payload: ChatRetryPayload): Promise<ChatSendResult> {
    if (!await chatSession.loadSession(payload.sessionId))
      throw new Error('Failed to load the target chat session')

    const currentMessages = chatSession.getSessionMessages(payload.sessionId)
    const sourceIndex = retrySourceIndexFrom(currentMessages, payload.index)
    if (sourceIndex < 0)
      throw new Error('Retry target has no retriable source message')

    const sourceMessage = currentMessages[sourceIndex]
    const text = retryTextFrom(sourceMessage)
    if (!text)
      throw new Error('Retry target has no retriable user message')

    chatSession.setSessionMessages(payload.sessionId, currentMessages.slice(0, sourceIndex))

    try {
      return await executeSend({
        sessionId: payload.sessionId,
        text,
        tools: payload.tools ?? sourceMessage?.tools,
      })
    }
    catch (error) {
      // A retried medical turn must end the same way a sent one does.
      const failureReply = handleSendFailure(payload.sessionId, error)
      if (failureReply)
        return failureReply

      throw error
    }
  }

  /** Runs one stored tool call again and replaces its stored result. */
  async function rerunToolCall(payload: ChatToolCallRerunPayload): Promise<void> {
    if (!await chatSession.loadSession(payload.sessionId))
      throw new Error('Failed to load the target chat session')

    const nextMessages = await executeToolCallRerun({
      messages: chatSession.getSessionMessages(payload.sessionId),
      payload,
      resolveTools: () => resolveLlmTools({
        customTools: llmToolsStore.getToolsByNames(payload.toolName),
      }),
    })
    chatSession.setSessionMessages(payload.sessionId, nextMessages)
  }

  /** Clears one session and stops runtime work that still belongs to it. */
  function cleanup(sessionId: string) {
    lastRouteBySession.delete(sessionId)
    chatSession.cleanupMessages(sessionId)
    chatContext.resetContexts()
    runtime.cancelPendingSends(sessionId)
    chatStream.resetStream()
  }

  /** Cancels queued work before permanently removing its owning session. */
  function deleteSession(sessionId: string): Promise<void> {
    lastRouteBySession.delete(sessionId)
    runtime.cancelPendingSends(sessionId)
    return chatSession.deleteSession(sessionId)
  }

  async function ingestOnFork(
    sendingMessage: string,
    options: ChatOrchestratorSendOptions,
    forkOptions?: ForkOptions,
  ) {
    const baseSessionId = forkOptions?.fromSessionId ?? activeSessionId.value
    if (!forkOptions)
      return ingest(sendingMessage, options, baseSessionId)

    const forkSessionId = await chatSession.forkSession({
      fromSessionId: baseSessionId,
      atIndex: forkOptions.atIndex,
      reason: forkOptions.reason,
      hidden: forkOptions.hidden,
    })
    return ingest(sendingMessage, options, forkSessionId || baseSessionId)
  }

  function cancelPendingSends(sessionId?: string) {
    runtime.cancelPendingSends(sessionId)
  }

  function getPendingQueuedSendSnapshot() {
    return runtime.getPendingQueuedSendSnapshot()
  }

  return {
    sending,
    activeSendSessionId,
    activeStreamingMessage,
    pendingQueuedSendCount,

    initialize,
    dispose,
    cleanup,
    deleteSession,
    ingest,
    ingestOnFork,
    rerunToolCall,
    retry,
    send,
    cancelPendingSends,
    getPendingQueuedSendSnapshot,

    clearHooks: runtime.hooks.clearHooks,

    emitBeforeMessageComposedHooks: runtime.hooks.emitBeforeMessageComposedHooks,
    emitAfterMessageComposedHooks: runtime.hooks.emitAfterMessageComposedHooks,
    emitBeforeSendHooks: runtime.hooks.emitBeforeSendHooks,
    emitAfterSendHooks: runtime.hooks.emitAfterSendHooks,
    emitTokenLiteralHooks: runtime.hooks.emitTokenLiteralHooks,
    emitTokenSpecialHooks: runtime.hooks.emitTokenSpecialHooks,
    emitStreamEndHooks: runtime.hooks.emitStreamEndHooks,
    emitAssistantResponseEndHooks: runtime.hooks.emitAssistantResponseEndHooks,
    emitAssistantMessageHooks: runtime.hooks.emitAssistantMessageHooks,
    emitChatTurnCompleteHooks: runtime.hooks.emitChatTurnCompleteHooks,

    onBeforeMessageComposed: runtime.hooks.onBeforeMessageComposed,
    onAfterMessageComposed: runtime.hooks.onAfterMessageComposed,
    onBeforeSend: runtime.hooks.onBeforeSend,
    onAfterSend: runtime.hooks.onAfterSend,
    onTokenLiteral: runtime.hooks.onTokenLiteral,
    onTokenSpecial: runtime.hooks.onTokenSpecial,
    onStreamEnd: runtime.hooks.onStreamEnd,
    onAssistantResponseEnd: runtime.hooks.onAssistantResponseEnd,
    onAssistantMessage: runtime.hooks.onAssistantMessage,
    onChatTurnComplete: runtime.hooks.onChatTurnComplete,
  }
}, {
  synced: {
    actions: ['cleanup', 'deleteSession', 'rerunToolCall', 'retry', 'send'],
    state: true,
  },
})
