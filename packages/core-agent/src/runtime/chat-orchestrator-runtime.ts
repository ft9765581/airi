import type { ChatProvider } from '@xsai-ext/providers/utils'
import type { CommonContentPart, Message, ToolMessage } from '@xsai/shared-chat'

import type { AgentContextPort } from '../contracts/context-port'
import type { AgentForegroundStreamPort } from '../contracts/stream-port'
import type { ChatAssistantMessage, ChatHistoryItem, ChatSlices, ChatStreamEventContext, ChatToolReference, ContextMessage, ErrorMessage, StreamingAssistantMessage, TurnRouteResult } from '../types/chat'
import type { LlmUsage, StreamEvent, StreamOptions } from '../types/llm'

import { createQueue } from '@proj-airi/stream-kit'

import { formatContextPromptText } from '../messages/context-prompt'
import { formatTimePrefix } from '../messages/datetime-prefix'
import { createChatHooks } from './agent-hooks'
import { useLlmmarkerParser } from './llm-marker-parser'
import { categorizeResponse, createStreamingCategorizer } from './response-categoriser'

const REASONING_UI_FLUSH_CHUNK_SIZE = 24

/**
 * The send state a runtime context provider receives.
 *
 * A provider that needs the user question, such as a knowledge base retrieval,
 * reads `message`. A provider that reports store state only can ignore the
 * input.
 */
export interface RuntimeContextProviderInput {
  /** The message text of the send under composition. */
  message: string
  /** The session the send belongs to. */
  sessionId: string
}

/**
 * Contributes one context message to the prompt of a send.
 *
 * A provider can return a promise, because it can read the network. The send
 * waits for every provider before it composes the prompt. A provider that
 * returns `null` adds no context for that send.
 */
export type RuntimeContextProvider = (
  input: RuntimeContextProviderInput,
) => ContextMessage | null | undefined | Promise<ContextMessage | null | undefined>

function prependTextToContent<T extends { content?: unknown }>(msg: T, text: string): T {
  const content = msg.content
  if (content === undefined)
    return { ...msg, content: text }
  if (typeof content === 'string')
    return { ...msg, content: `${text}${content}` }

  if (Array.isArray(content)) {
    const first = content[0] as { type?: string, text?: string } | undefined
    if (first && first.type === 'text' && typeof first.text === 'string') {
      const next = [{ ...first, text: `${text}${first.text}` }, ...content.slice(1)]
      return { ...msg, content: next }
    }
    return { ...msg, content: [{ type: 'text', text }, ...content] }
  }

  return msg
}

function cloneStreamingMessage(message: StreamingAssistantMessage): StreamingAssistantMessage {
  try {
    return structuredClone(message)
  }
  catch {
    return JSON.parse(JSON.stringify(message)) as StreamingAssistantMessage
  }
}

/** Resolves the provider of one send, whether it arrived ready or as a resolver. */
async function resolveSendChat(
  options: ChatOrchestratorSendOptions,
): Promise<{ model: string, chatProvider: ChatProvider }> {
  if ('resolveChat' in options)
    return await options.resolveChat()

  return { model: options.model, chatProvider: options.chatProvider }
}

/** The parts of one send that do not depend on a resolved chat provider. */
export interface ChatOrchestratorCommonSendOptions {
  /** Provider-specific request options, currently used for headers. */
  providerConfig?: Record<string, unknown>
  /** Image attachments appended to the user message content parts. */
  attachments?: { type: 'image', data: string, mimeType: string }[]
  /** Tool definitions passed through to the LLM stream port. */
  tools?: StreamOptions['tools']
  /** Serializable tool names stored with the user message for later requests. */
  toolReferences?: ChatToolReference[]
  /** Original transport input metadata used by bridge/devtools observers. */
  input?: ChatStreamEventContext['input']
}

/** One chat provider and model, either resolved or resolvable later. */
export type ChatProviderTarget
  = | { model: string, chatProvider: ChatProvider }
    | { resolveChat: () => Promise<{ model: string, chatProvider: ChatProvider }> }

/**
 * Options accepted by the chat orchestrator runtime for one user send.
 *
 * A send can arrive with its provider already resolved, or with a resolver. The
 * resolver runs after the queued turn is routed, because a turn that answers
 * without the model (urgent guidance, a fixed reply) must work with no provider
 * configured.
 */
export type ChatOrchestratorSendOptions = ChatOrchestratorCommonSendOptions & ChatProviderTarget

interface QueuedSend {
  sendingMessage: string
  options: ChatOrchestratorSendOptions
  generation: number
  sessionId: string
  cancelled?: boolean
  deferred: {
    resolve: () => void
    reject: (error: unknown) => void
  }
}

/**
 * Serializable view of a queued send waiting to be processed.
 */
export interface QueuedSendSnapshot {
  /** Session that owns the queued send. */
  sessionId: string
  /** Session generation captured when the send was enqueued. */
  generation: number
  /** Whether the queued send has been rejected before execution. */
  cancelled: boolean
  /** First 120 characters of the pending user message. */
  messagePreview: string
  /** Whether the queued send carries image attachments. */
  hasAttachments: boolean
  /** Optional input event type for transport-originated sends. */
  inputType?: NonNullable<ChatStreamEventContext['input']>['type']
}

/**
 * Session operations required by the core chat orchestrator runtime.
 */
export interface ChatOrchestratorSessionPort {
  /** Ensures a session exists before messages are appended. */
  ensureSession: (sessionId: string) => void
  /** Returns chronological chat history for a session. */
  getSessionMessages: (sessionId: string) => ChatHistoryItem[]
  /** Appends a finalized user/assistant/tool history item. */
  appendSessionMessage: (sessionId: string, message: ChatHistoryItem) => void
  /** Returns a monotonic generation used to reject stale queued sends. */
  getSessionGeneration: (sessionId: string) => number
}

/**
 * LLM streaming boundary used by the core chat orchestrator runtime.
 */
export interface ChatOrchestratorLLMPort {
  /** Streams one composed chat request and emits normalized stream events. */
  stream: (model: string, chatProvider: ChatProvider, messages: Message[], options?: StreamOptions) => Promise<void>
}

/**
 * Lifecycle record emitted around prompt composition.
 */
export interface ChatOrchestratorLifecycleRecord {
  /** Composition phase being observed. */
  phase: 'before-compose' | 'prompt-context-built' | 'after-compose'
  /** Logical event channel for context observability. */
  channel: 'chat'
  /** Session associated with this send. */
  sessionId: string
  /** Optional compact preview of the user text. */
  textPreview?: string
  /** Phase-specific payload for devtools and diagnostics. */
  details?: unknown
}

/**
 * Prompt projection emitted after the runtime has composed provider messages.
 */
export interface ChatOrchestratorPromptProjection {
  /** Session associated with the projected prompt. */
  sessionId: string
  /** Raw user message text that triggered the prompt. */
  message: string
  /** Active context snapshot read during prompt composition. */
  contexts: Record<string, ContextMessage[]>
  /** Historical standalone context prompt shape, kept for compatibility. */
  promptMessage?: Message | null
  /** Provider-ready message array sent to the LLM port. */
  composedMessage?: Message[]
}

/**
 * Reactive state mirrored by UI facades.
 */
export interface ChatOrchestratorRuntimeState {
  /** Whether the runtime currently owns an active send. */
  sending: boolean
  /** Session that owns the active send; undefined while the queue is idle. */
  activeSendSessionId?: string
  /** Latest assistant stream snapshot owned by the active send session. */
  activeStreamingMessage?: StreamingAssistantMessage
  /** Number of sends waiting behind the active one. */
  pendingQueuedSendCount: number
}

/** Correlation keys shared by every analytics milestone from one user-to-assistant round. */
interface ChatRoundCorrelation {
  /** Application conversation that owns the round. */
  conversationId: string
  /** Stable round key; the runtime reuses the persisted user-message ID. */
  roundId: string
  /** One-based user turn position within the conversation. */
  turnIndex: number
}

/**
 * Dependency surface used by the platform-agnostic chat orchestrator runtime.
 */
export interface ChatOrchestratorRuntimeDeps {
  /** Session persistence and generation guard port. */
  session: ChatOrchestratorSessionPort
  /** Context registry facade used for runtime context ingest and prompt snapshots. */
  context: Pick<AgentContextPort, 'ingest' | 'snapshot'>
  /** Foreground assistant stream port controlled by the UI facade. */
  foregroundStream: AgentForegroundStreamPort
  /** Provider-agnostic LLM streaming port. */
  llm: ChatOrchestratorLLMPort
  /** Returns the currently visible session ID. */
  getActiveSessionId: () => string
  /** Returns the currently active provider ID for categorization policy. */
  getActiveProvider: () => string | undefined
  /** Returns optional prompt text appended to the provider system message for this send. */
  getSystemPromptSupplement?: () => string | undefined
  /**
   * Decides the branch for one dequeued turn.
   *
   * It runs after the send leaves the queue and before the prompt is assembled,
   * so the router reads the session as it stands after every earlier turn. A
   * result with `reply` ends the turn without a model request, which is why the
   * provider is resolved only when no reply is returned.
   */
  routeTurn?: (context: {
    sessionId: string
    message: string
    /** Turns before this one, oldest first, as a snapshot. The current message is separate. */
    history: ChatHistoryItem[]
  }) => Promise<TurnRouteResult | undefined>
  /** Runtime context providers ingested immediately before prompt composition. */
  runtimeContextProviders?: RuntimeContextProvider[]
  /** Clock used for persisted message timestamps. @default Date.now */
  now?: () => number
  /** Monotonic clock used for elapsed telemetry in milliseconds. @default performance.now */
  monotonicNow?: () => number
  /** ID factory used for persisted chat messages. @default crypto.randomUUID fallback */
  createId?: () => string
  /** Optional adapter for removing framework proxies before provider composition. */
  unwrapMessage?: <T>(message: T) => T
  /** Called whenever writable runtime state changes. */
  onStateChange?: (state: ChatOrchestratorRuntimeState) => void
  /** Called after a runtime-owned send completes or fails and `sending` has been cleared. */
  onSendSettled?: (event: { sessionId: string }) => void
  /** Called when a send starts and the first assistant placeholder is created. */
  onTrackFirstMessage?: () => void
  /** Called for attempts made before the conversation has its first assistant response. */
  onChatActivationStarted?: (event: ChatRoundCorrelation & {
    source: 'text' | 'voice'
    model: string
    provider: string
  }) => void
  /** Called when the conversation reaches its first successful assistant response. */
  onChatActivationSucceeded?: (event: ChatRoundCorrelation & {
    source: 'text' | 'voice'
    model: string
    provider: string
    durationMs: number
  }) => void
  /** Called when a pre-activation attempt fails before assistant completion. */
  onChatActivationFailed?: (event: ChatRoundCorrelation & {
    source: 'text' | 'voice'
    model: string
    provider: string
    failureStage: 'llm_response'
    errorCode: 'llm_response_failed'
  }) => void
  /** Called when a user message send begins. */
  onMessageSendStarted?: (event: ChatRoundCorrelation & {
    source: 'text' | 'voice'
    model: string
  }) => void
  /** Called immediately before the provider LLM request starts. */
  onLlmRequestStarted?: (event: ChatRoundCorrelation & {
    model: string
    provider: string
    hasVoice: boolean
  }) => void
  /** Called when the first text token arrives from the provider stream. */
  onLlmFirstToken?: (event: ChatRoundCorrelation & {
    model: string
    ttfbMs: number
  }) => void
  /** Called after the assistant stream is parsed and rendered into runtime state. */
  onAssistantResponseRendered?: (event: ChatRoundCorrelation & {
    model: string
    latencyMs: number
  }) => void
  /** Called once per completed provider generation with content-free usage metadata. */
  onLlmGeneration?: (event: ChatRoundCorrelation & {
    model: string
    provider: string
    inputTokens?: number
    outputTokens?: number
    totalTokens?: number
    usageSource: LlmUsage['source']
  }) => void
  /** Called after one user-to-assistant message round completes successfully. */
  onMessageRound?: (event: ChatRoundCorrelation & {
    durationMs: number
    hasVoice: boolean
    model: string
    inputTokens?: number
    outputTokens?: number
    totalTokens?: number
    usageSource: LlmUsage['source']
  }) => void
  /** Called whenever a user-to-assistant round fails before completion. */
  onMessageRoundFailed?: (event: ChatRoundCorrelation & {
    source: 'text' | 'voice'
    model: string
    provider: string
    failureStage: 'llm_response'
    errorCode: 'llm_response_failed'
  }) => void
  /** Called for context/prompt lifecycle observability. */
  onLifecycle?: (record: ChatOrchestratorLifecycleRecord) => void
  /** Called with the final provider prompt projection. */
  onPromptProjection?: (payload: ChatOrchestratorPromptProjection) => void
  /** Called after the user message has been appended to session history. */
  onUserMessageAppended?: (event: {
    sessionId: string
    message: Extract<ChatHistoryItem, { role: 'user' }> & { id: string }
    messageText: string
    source: 'text' | 'voice'
    model: string
    provider: string
    roundId: string
    turnIndex: number
  }) => void
  /** Called after the assistant message has been finalized into session history. */
  onAssistantMessageAppended?: (event: {
    sessionId: string
    message: StreamingAssistantMessage
    messageText: string
  }) => void
  /** Called after user turn persistence, before provider prompt composition. */
  onUserTurnReady?: (event: {
    /** Session that owns the turn, so a consumer can read its branch record. */
    sessionId: string
    messageText: string
    sessionMessages: ChatHistoryItem[]
  }) => void
  /** Called after assistant streaming and hook finalization. */
  onAssistantTurnReady?: (event: {
    /** Session that owns the turn, so a consumer can read its branch record. */
    sessionId: string
    messageText: string
    sessionMessages: ChatHistoryItem[]
  }) => void
}

/**
 * Platform-agnostic chat orchestrator runtime API.
 */
export interface ChatOrchestratorRuntime {
  /** Enqueues a user send for the target session, preserving FIFO order. */
  ingest: (sendingMessage: string, options: ChatOrchestratorSendOptions, targetSessionId?: string) => Promise<void>
  /** Rejects queued sends that have not started yet. */
  cancelPendingSends: (sessionId?: string) => void
  /** Returns serializable snapshots of currently queued sends. */
  getPendingQueuedSendSnapshot: () => QueuedSendSnapshot[]
  /** Returns the current queued send count. */
  getPendingQueuedSendCount: () => number
  /** Reads the writable sending flag. */
  getSending: () => boolean
  /** Updates the writable sending flag and notifies facade mirrors. */
  setSending: (next: boolean) => void
  /** Hook registry preserved from the previous stage-ui store API. */
  hooks: ReturnType<typeof createChatHooks>
}

function defaultCreateId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

/**
 * Creates the core chat orchestrator runtime used behind UI facades.
 *
 * Use when:
 * - A platform wants AIRI chat send orchestration without Vue/Pinia coupling.
 * - Session, context, foreground stream, and LLM integrations are provided as adapters.
 *
 * Expects:
 * - Session messages are returned in chronological order.
 * - `foregroundStream.patch` replaces the visible streaming assistant message.
 *
 * Returns:
 * - A runtime with send queue APIs, hook registry, writable sending state, and queue snapshots.
 */
export function createChatOrchestratorRuntime(deps: ChatOrchestratorRuntimeDeps): ChatOrchestratorRuntime {
  const hooks = createChatHooks()
  const now = deps.now ?? (() => Date.now())
  const monotonicNow = deps.monotonicNow ?? (() => globalThis.performance?.now?.() ?? Date.now())
  const createId = deps.createId ?? defaultCreateId
  const unwrapMessage = deps.unwrapMessage ?? (<T>(message: T) => message)

  let sending = false
  let activeSendSessionId: string | undefined
  let activeStreamingMessage: StreamingAssistantMessage | undefined
  let pendingQueuedSends: QueuedSend[] = []

  function emitStateChange() {
    deps.onStateChange?.({
      sending,
      activeSendSessionId,
      activeStreamingMessage,
      pendingQueuedSendCount: pendingQueuedSends.length,
    })
  }

  function setSending(next: boolean) {
    const nextActiveSendSessionId = next
      ? activeSendSessionId ?? deps.getActiveSessionId()
      : undefined
    if (sending === next && activeSendSessionId === nextActiveSendSessionId)
      return
    sending = next
    activeSendSessionId = nextActiveSendSessionId
    if (!next)
      activeStreamingMessage = undefined
    emitStateChange()
  }

  function isForegroundSession(sessionId: string) {
    return sessionId === deps.getActiveSessionId()
  }

  function beginStream(sessionId: string, message: StreamingAssistantMessage) {
    sending = true
    activeSendSessionId = sessionId
    activeStreamingMessage = cloneStreamingMessage(message)
    emitStateChange()

    if (isForegroundSession(sessionId))
      deps.foregroundStream.patch(cloneStreamingMessage(message))
  }

  function updateStream(sessionId: string, message: StreamingAssistantMessage) {
    if (sessionId === activeSendSessionId) {
      activeStreamingMessage = cloneStreamingMessage(message)
      emitStateChange()
    }

    if (isForegroundSession(sessionId))
      deps.foregroundStream.patch(cloneStreamingMessage(message))
  }

  function resetForegroundStream(sessionId: string) {
    if (isForegroundSession(sessionId))
      deps.foregroundStream.reset()
  }

  /**
   * Ingests the side context that the runtime providers contribute to one send.
   *
   * The providers run at the same time, because one of them can wait on the
   * network. The messages are ingested in provider order, not in the order the
   * promises settle, so the prompt stays stable across sends.
   */
  async function ingestRuntimeContexts(input: RuntimeContextProviderInput) {
    const contextMessages = await Promise.all(
      (deps.runtimeContextProviders ?? []).map(provider => provider(input)),
    )

    for (const contextMessage of contextMessages) {
      if (contextMessage)
        deps.context.ingest(contextMessage)
    }
  }

  function getStablePromptTimestamp(message: ChatHistoryItem, fallbackCreatedAt: number) {
    if (typeof message.createdAt === 'number')
      return message.createdAt

    message.createdAt = fallbackCreatedAt
    return fallbackCreatedAt
  }

  function buildProviderMessages(sessionMessagesForSend: ChatHistoryItem[]): Array<Message | ErrorMessage> {
    const nowTs = now()

    return sessionMessagesForSend.flatMap<Message | ErrorMessage>((msg) => {
      // `route` is local bookkeeping for the chat UI. Stripping it here keeps it
      // out of every provider request, including replays of stored history.
      const { context: _context, id: _id, createdAt: _createdAt, tools: _tools, route: _route, ...withoutContext } = msg
      const rawMessage = unwrapMessage(withoutContext)

      if (rawMessage.role === 'user') {
        return [prependTextToContent(rawMessage, formatTimePrefix(getStablePromptTimestamp(msg, nowTs)))]
      }

      if (rawMessage.role === 'assistant') {
        const {
          slices: _slices,
          tool_results: _toolResults,
          providerTranscript,
          categorization: _categorization,
          ...rest
        } = rawMessage as ChatAssistantMessage

        if (providerTranscript?.length)
          return providerTranscript.map(message => unwrapMessage(message))

        return [unwrapMessage(rest)]
      }

      return [rawMessage]
    })
  }

  async function performSend(
    sendingMessage: string,
    options: ChatOrchestratorSendOptions,
    generation: number,
    sessionId: string,
  ) {
    if (!sendingMessage && !options.attachments?.length)
      return

    deps.session.ensureSession(sessionId)

    const existingSessionMessages = deps.session.getSessionMessages(sessionId)
    const turnIndex = existingSessionMessages.filter(message => message.role === 'user').length + 1

    // Activation measures whether a conversation reaches its first assistant
    // response. Later turns still emit message and latency telemetry, but they
    // must not inflate the one-time activation milestones.
    const isActivationAttempt = !existingSessionMessages.some(message => message.role === 'assistant')

    const isStaleGeneration = () => deps.session.getSessionGeneration(sessionId) !== generation
    const shouldAbort = () => isStaleGeneration()

    // Route before the runtime contexts are read. An urgent turn and the fixed
    // reply must not depend on a source that only a model answer needs, and an
    // isolated turn must not carry the general chat context into its prompt.
    const routeResult = deps.routeTurn
      ? await deps.routeTurn({
          sessionId,
          message: sendingMessage,
          // A snapshot, because the session keeps appending to its own array
          // and the router may hold this list while it classifies.
          history: existingSessionMessages.slice(),
        })
      : undefined
    const replied = routeResult?.reply !== undefined
    const isolated = replied || routeResult?.isolate === true

    if (shouldAbort())
      return

    // Datetime is no longer injected through the side-channel context store.
    // It is applied at message-assembly time (see below) as a system-prompt
    // date anchor + per-message [HH:MM] prefixes, which is more KV-cache
    // friendly and less prone to weak models echoing timestamps verbatim.
    if (!isolated)
      await ingestRuntimeContexts({ message: sendingMessage, sessionId })

    const sendingCreatedAt = now()
    const contextsSnapshot = isolated ? {} : deps.context.snapshot()

    // A routed branch that looked its own data up cannot use a provider: an
    // isolated turn skips them all. Its messages therefore join the snapshot
    // here, so one rendering path serves both sources.
    for (const contextMessage of routeResult?.contextMessages ?? []) {
      const bucket = contextsSnapshot[contextMessage.contextId] ??= []
      bucket.push(contextMessage)
    }

    // TODO: Expire or prune stale runtime contexts from disconnected services before composing.
    // Allocate the three per-round ids in their historical order so callers
    // with deterministic id factories keep the same durable message ids.
    const streamContextMessageId = createId()
    const assistantMessageId = createId()
    const roundId = createId()
    const streamingMessageContext: ChatStreamEventContext = {
      turnId: roundId,
      message: { role: 'user', content: sendingMessage, createdAt: sendingCreatedAt, id: streamContextMessageId },
      contexts: contextsSnapshot,
      composedMessage: [],
      input: options.input,
    }
    deps.onLifecycle?.({
      phase: 'before-compose',
      channel: 'chat',
      sessionId,
      textPreview: sendingMessage,
      details: {
        contexts: streamingMessageContext.contexts,
      },
    })

    if (shouldAbort())
      return

    const buildingMessage: StreamingAssistantMessage = {
      role: 'assistant',
      content: '',
      slices: [],
      tool_results: [],
      createdAt: now(),
      id: assistantMessageId,
      ...(routeResult ? { route: routeResult.route } : {}),
    }
    beginStream(sessionId, buildingMessage)
    const hasVoice = options.input?.type === 'input:voice'
      || options.input?.type === 'input:text:voice'
    const sendSource = hasVoice ? 'voice' : 'text'
    const activeProvider = deps.getActiveProvider?.() ?? ''
    // The user message is the durable start of a round, so its ID also serves
    // as the correlation key for every telemetry milestone emitted by it.
    const correlation: ChatRoundCorrelation = {
      conversationId: sessionId,
      roundId,
      turnIndex,
    }
    deps.onTrackFirstMessage?.()
    const roundStartedAt = monotonicNow()
    // An empty model name means no model took part in the turn. Telemetry keeps
    // the field so one shape covers both branches, and the failure path can
    // still name it when resolution itself throws.
    let modelName = ''

    try {
      await hooks.emitBeforeMessageComposedHooks(sendingMessage, streamingMessageContext)

      // The provider is resolved only for a turn that reaches the model, so the
      // reply branch works on a deployment that has no chat provider.
      const resolvedChat = replied ? undefined : await resolveSendChat(options)
      modelName = resolvedChat?.model ?? ''

      if (shouldAbort())
        return

      if (isActivationAttempt) {
        deps.onChatActivationStarted?.({
          ...correlation,
          source: sendSource,
          model: modelName,
          provider: activeProvider,
        })
      }
      deps.onMessageSendStarted?.({
        ...correlation,
        source: sendSource,
        model: modelName,
      })

      const contentParts: CommonContentPart[] = [{ type: 'text', text: sendingMessage }]

      if (options.attachments) {
        for (const attachment of options.attachments) {
          if (attachment.type === 'image') {
            contentParts.push({
              type: 'image_url',
              image_url: {
                url: `data:${attachment.mimeType};base64,${attachment.data}`,
              },
            })
          }
        }
      }

      const finalContent = contentParts.length > 1 ? contentParts : sendingMessage
      if (!streamingMessageContext.input) {
        streamingMessageContext.input = {
          type: 'input:text',
          data: {
            text: sendingMessage,
          },
        }
      }

      if (shouldAbort())
        return

      const userMessage = {
        role: 'user' as const,
        content: finalContent,
        createdAt: sendingCreatedAt,
        id: roundId,
        ...(options.toolReferences?.length ? { tools: options.toolReferences } : {}),
      }
      deps.session.appendSessionMessage(sessionId, userMessage)

      // Cloud sync v1: only the raw text part round-trips; image attachments
      // and other non-text parts stay local.
      deps.onUserMessageAppended?.({
        sessionId,
        message: userMessage,
        messageText: sendingMessage,
        source: sendSource,
        model: modelName,
        provider: activeProvider,
        roundId,
        turnIndex,
      })

      const sessionMessagesForSend = deps.session.getSessionMessages(sessionId)
      deps.onUserTurnReady?.({
        sessionId,
        messageText: sendingMessage,
        sessionMessages: sessionMessagesForSend,
      })

      const categorizer = createStreamingCategorizer(deps.getActiveProvider())
      let streamPosition = 0

      const parser = useLlmmarkerParser({
        onLiteral: async (literal) => {
          if (shouldAbort())
            return

          categorizer.consume(literal)

          const speechOnly = categorizer.filterToSpeech(literal, streamPosition)
          streamPosition += literal.length

          if (speechOnly.trim()) {
            buildingMessage.content += speechOnly

            await hooks.emitTokenLiteralHooks(speechOnly, streamingMessageContext)

            const lastSlice = buildingMessage.slices.at(-1)
            if (lastSlice?.type === 'text') {
              lastSlice.text += speechOnly
            }
            else {
              buildingMessage.slices.push({
                type: 'text',
                text: speechOnly,
              })
            }
            updateStream(sessionId, buildingMessage)
          }
        },
        onSpecial: async (special) => {
          if (shouldAbort())
            return

          await hooks.emitTokenSpecialHooks(special, streamingMessageContext)
        },
        onEnd: async (fullText) => {
          if (isStaleGeneration())
            return

          const finalCategorization = categorizeResponse(fullText, deps.getActiveProvider())

          const reasoningContentField = buildingMessage.categorization?.reasoning?.trim()
          buildingMessage.categorization = {
            speech: finalCategorization.speech,
            reasoning: reasoningContentField || finalCategorization.reasoning,
          }
          updateStream(sessionId, buildingMessage)
        },
        // The parser keeps its own marker-safety tail. Emit each safe literal
        // chunk so slow providers update the chat before they reach 24 characters.
        minLiteralEmitLength: 1,
      })

      const toolCallQueue = createQueue<ChatSlices>({
        handlers: [
          async (ctx) => {
            if (shouldAbort())
              return
            if (ctx.data.type === 'tool-call') {
              buildingMessage.slices.push(ctx.data)
              updateStream(sessionId, buildingMessage)
              return
            }

            if (ctx.data.type === 'tool-call-result') {
              buildingMessage.tool_results.push(ctx.data)
              updateStream(sessionId, buildingMessage)
            }
          },
        ],
      })

      const newMessages = buildProviderMessages(sessionMessagesForSend)

      // The router owns the whole system message of a routed turn, because only
      // the caller knows which part of the stored message is character prompt.
      // A plain routed turn still receives the supplement below, so shared
      // format instructions survive a replacement.
      const systemPromptOverride = routeResult?.systemPrompt?.trim()
      if (systemPromptOverride) {
        const systemIndex = newMessages.findIndex(message => message.role === 'system')
        if (systemIndex === -1)
          newMessages.unshift({ role: 'system', content: systemPromptOverride })
        else
          newMessages[systemIndex] = { role: 'system', content: systemPromptOverride }
      }

      // An isolated turn carries a complete system message and no general chat
      // tools, so the toolset supplement would describe tools it cannot use.
      const systemPromptSupplement = isolated ? undefined : deps.getSystemPromptSupplement?.()?.trim()
      if (systemPromptSupplement) {
        const systemMessage = newMessages.find(message => message.role === 'system')
        if (systemMessage) {
          systemMessage.content = `${systemMessage.content}\n\n${systemPromptSupplement}`
        }
        else {
          newMessages.unshift({
            role: 'system',
            content: systemPromptSupplement,
          })
        }
      }

      const contextPromptText = formatContextPromptText(contextsSnapshot)
      if (contextPromptText) {
        const lastMessage = newMessages.at(-1)
        if (lastMessage && lastMessage.role === 'user') {
          const existingParts = typeof lastMessage.content === 'string'
            ? [{ type: 'text' as const, text: lastMessage.content }]
            : lastMessage.content

          lastMessage.content = [
            ...existingParts,
            { type: 'text' as const, text: `\n${contextPromptText}` },
          ]
        }

        deps.onLifecycle?.({
          phase: 'prompt-context-built',
          channel: 'chat',
          sessionId,
          details: {
            contexts: contextsSnapshot,
            promptText: contextPromptText,
          },
        })
      }

      streamingMessageContext.composedMessage = newMessages as Message[]
      deps.onPromptProjection?.({
        sessionId,
        message: sendingMessage,
        contexts: contextsSnapshot,
        promptMessage: undefined,
        composedMessage: newMessages as Message[],
      })
      deps.onLifecycle?.({
        phase: 'after-compose',
        channel: 'chat',
        sessionId,
        textPreview: sendingMessage,
        details: {
          composedMessage: newMessages,
        },
      })

      await hooks.emitAfterMessageComposedHooks(sendingMessage, streamingMessageContext)
      await hooks.emitBeforeSendHooks(sendingMessage, streamingMessageContext)

      let fullText = ''
      const headers = (options.providerConfig?.headers || {}) as Record<string, string>

      if (shouldAbort())
        return

      const llmRequestStartedAt = monotonicNow()
      let generationUsage: LlmUsage = { source: 'unavailable' }
      let providerTranscript: Message[] | undefined

      const replyText = routeResult?.reply
      if (replyText !== undefined) {
        // A replied turn writes its text through the same parser a streamed
        // answer uses, so the stored message, the slices, the hooks and the
        // telemetry keep one shape.
        fullText = replyText
        await parser.consume(fullText)
      }
      else {
        if (!resolvedChat)
          throw new Error('Chat provider was not resolved for a model turn')

        let llmFirstTokenEmitted = false
        const providerInputMessageCount = newMessages.length
        deps.onLlmRequestStarted?.({
          ...correlation,
          model: modelName,
          provider: deps.getActiveProvider() || 'unknown',
          hasVoice,
        })

        await deps.llm.stream(modelName, resolvedChat.chatProvider, newMessages as Message[], {
          headers,
          requestCorrelation: {
            conversationId: correlation.conversationId,
            roundId: correlation.roundId,
          },
          // An isolated turn carries no general chat tools. Its prompt holds the
          // same-session history and the routed system message only.
          tools: isolated ? undefined : options.tools,
          waitForTools: true,
          onMessages: (messages) => {
            const currentTurnMessages = messages.slice(providerInputMessageCount)
            const hasToolRound = currentTurnMessages.some(message =>
              message.role === 'tool'
              || (message.role === 'assistant' && Boolean(message.tool_calls?.length)),
            )

            if (hasToolRound)
              providerTranscript = structuredClone(currentTurnMessages)
          },
          onUsage: (usage) => {
            if (shouldAbort())
              return

            generationUsage = usage
            deps.onLlmGeneration?.({
              ...correlation,
              model: modelName,
              provider: activeProvider,
              inputTokens: usage.inputTokens,
              outputTokens: usage.outputTokens,
              totalTokens: usage.totalTokens,
              usageSource: usage.source,
            })
          },
          onStreamEvent: async (event: StreamEvent) => {
            if (shouldAbort())
              return

            switch (event.type) {
              case 'tool-call':
                toolCallQueue.enqueue({
                  type: 'tool-call',
                  toolCall: event,
                })

                break
              case 'tool-result':
                toolCallQueue.enqueue({
                  type: 'tool-call-result',
                  id: event.toolCallId,
                  result: event.result,
                })

                break
              case 'tool-error':
                toolCallQueue.enqueue({
                  type: 'tool-call-result',
                  id: event.toolCallId,
                  isError: true,
                  result: event.result,
                })

                break
              case 'text-delta':
                if (!llmFirstTokenEmitted) {
                  llmFirstTokenEmitted = true
                  deps.onLlmFirstToken?.({
                    ...correlation,
                    model: modelName,
                    ttfbMs: Math.round(monotonicNow() - llmRequestStartedAt),
                  })
                }
                fullText += event.text
                await parser.consume(event.text)
                break
              case 'reasoning-delta': {
                if (shouldAbort())
                  return

                const { reasoning = '' } = buildingMessage.categorization ?? {}
                const nextReasoning = reasoning + event.text
                buildingMessage.categorization = {
                  speech: typeof buildingMessage.content === 'string' ? buildingMessage.content : '',
                  reasoning: nextReasoning,
                }
                const crossesBoundary
                  = Math.floor(nextReasoning.length / REASONING_UI_FLUSH_CHUNK_SIZE)
                    > Math.floor(reasoning.length / REASONING_UI_FLUSH_CHUNK_SIZE)
                if (!reasoning || crossesBoundary)
                  updateStream(sessionId, buildingMessage)
                break
              }
              case 'finish':
                break
              case 'error':
                throw event.error ?? new Error('Stream error')
            }
          },
        })
      }

      // Session generation is the lifecycle correlation key. Re-check it
      // after every awaited completion boundary so deleting a session while a
      // plugin hook runs cannot leak later hooks or success analytics.
      if (shouldAbort())
        return

      await parser.end()
      if (shouldAbort())
        return

      buildingMessage.providerTranscript = providerTranscript
      deps.onAssistantResponseRendered?.({
        ...correlation,
        model: modelName,
        latencyMs: Math.round(monotonicNow() - llmRequestStartedAt),
      })

      if (!isStaleGeneration() && buildingMessage.slices.length > 0) {
        const finalAssistant = buildingMessage
        deps.session.appendSessionMessage(sessionId, finalAssistant)
        deps.onAssistantMessageAppended?.({
          sessionId,
          message: finalAssistant,
          messageText: fullText,
        })
      }

      if (shouldAbort())
        return
      await hooks.emitStreamEndHooks(streamingMessageContext)
      if (shouldAbort())
        return
      await hooks.emitAssistantResponseEndHooks(fullText, streamingMessageContext)

      if (shouldAbort())
        return
      await hooks.emitAfterSendHooks(sendingMessage, streamingMessageContext)
      if (shouldAbort())
        return
      await hooks.emitAssistantMessageHooks({ ...buildingMessage }, fullText, streamingMessageContext)
      if (shouldAbort())
        return
      await hooks.emitChatTurnCompleteHooks({
        output: { ...buildingMessage },
        outputText: fullText,
        toolCalls: sessionMessagesForSend.filter(msg => msg.role === 'tool') as ToolMessage[],
      }, streamingMessageContext)

      if (shouldAbort())
        return
      deps.onAssistantTurnReady?.({
        sessionId,
        messageText: fullText,
        sessionMessages: sessionMessagesForSend,
      })

      resetForegroundStream(sessionId)
      const durationMs = Math.round(monotonicNow() - roundStartedAt)
      deps.onMessageRound?.({
        ...correlation,
        durationMs,
        hasVoice,
        model: modelName,
        inputTokens: generationUsage.inputTokens,
        outputTokens: generationUsage.outputTokens,
        totalTokens: generationUsage.totalTokens,
        usageSource: generationUsage.source,
      })
      if (isActivationAttempt) {
        deps.onChatActivationSucceeded?.({
          ...correlation,
          durationMs,
          source: sendSource,
          model: modelName,
          provider: activeProvider,
        })
      }
    }
    catch (error) {
      if (isStaleGeneration())
        return

      console.error('Error sending message:', error)
      deps.onMessageRoundFailed?.({
        ...correlation,
        source: sendSource,
        model: modelName,
        provider: activeProvider,
        failureStage: 'llm_response',
        errorCode: 'llm_response_failed',
      })
      if (isActivationAttempt) {
        deps.onChatActivationFailed?.({
          ...correlation,
          source: sendSource,
          model: modelName,
          provider: activeProvider,
          failureStage: 'llm_response',
          errorCode: 'llm_response_failed',
        })
      }
      throw error
    }
    finally {
      setSending(false)
      deps.onSendSettled?.({ sessionId })
    }
  }

  const sendQueue = createQueue<QueuedSend>({
    handlers: [
      async ({ data }) => {
        const { sendingMessage, options, generation, deferred, sessionId, cancelled } = data

        if (cancelled)
          return

        if (deps.session.getSessionGeneration(sessionId) !== generation) {
          deferred.reject(new Error('Chat session was reset before send could start'))
          return
        }

        try {
          await performSend(sendingMessage, options, generation, sessionId)
          deferred.resolve()
        }
        catch (error) {
          deferred.reject(error)
        }
      },
    ],
  })

  sendQueue.on('enqueue', (queuedSend) => {
    pendingQueuedSends.push(queuedSend)
    emitStateChange()
  })

  sendQueue.on('dequeue', (queuedSend) => {
    pendingQueuedSends = pendingQueuedSends.filter(item => item !== queuedSend)
    emitStateChange()
  })

  function ingest(
    sendingMessage: string,
    options: ChatOrchestratorSendOptions,
    targetSessionId?: string,
  ) {
    const sessionId = targetSessionId || deps.getActiveSessionId()
    const generation = deps.session.getSessionGeneration(sessionId)

    return new Promise<void>((resolve, reject) => {
      sendQueue.enqueue({
        sendingMessage,
        options,
        generation,
        sessionId,
        deferred: { resolve, reject },
      })
    })
  }

  function cancelPendingSends(sessionId?: string) {
    for (const queued of pendingQueuedSends) {
      if (sessionId && queued.sessionId !== sessionId)
        continue

      queued.cancelled = true
      queued.deferred.reject(new Error('Chat session was reset before send could start'))
    }

    pendingQueuedSends = sessionId
      ? pendingQueuedSends.filter(item => item.sessionId !== sessionId)
      : []
    emitStateChange()
  }

  function getPendingQueuedSendSnapshot() {
    return pendingQueuedSends.map(queued => ({
      sessionId: queued.sessionId,
      generation: queued.generation,
      cancelled: !!queued.cancelled,
      messagePreview: queued.sendingMessage.slice(0, 120),
      hasAttachments: !!queued.options.attachments?.length,
      inputType: queued.options.input?.type,
    } satisfies QueuedSendSnapshot))
  }

  return {
    ingest,
    cancelPendingSends,
    getPendingQueuedSendSnapshot,
    getPendingQueuedSendCount: () => pendingQueuedSends.length,
    getSending: () => sending,
    setSending,
    hooks,
  }
}
