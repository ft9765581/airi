import type { ContextUpdate, MetadataEventSource, WebSocketEventInputs } from '@proj-airi/server-shared/types'
import type { AssistantMessage, CommonContentPart, CompletionToolCall, Message, SystemMessage, ToolMessage, UserMessage } from '@xsai/shared-chat'

export interface ChatSlicesText {
  type: 'text'
  text: string
}

export interface ChatSlicesToolCall {
  type: 'tool-call'
  toolCall: CompletionToolCall
}

export interface ChatSlicesToolCallResult {
  type: 'tool-call-result'
  id: string
  isError?: boolean
  result?: string | CommonContentPart[]
}

export type ChatSlices = ChatSlicesText | ChatSlicesToolCall | ChatSlicesToolCallResult

export interface ChatAssistantMessage extends AssistantMessage {
  slices: ChatSlices[]
  tool_results: {
    id: string
    isError?: boolean
    result?: string | CommonContentPart[]
  }[]
  /**
   * Exact provider messages that xsAI added for this assistant turn.
   *
   * The chat UI keeps one aggregated assistant message. Tool loops can contain
   * multiple assistant and tool messages, so this transcript preserves their
   * protocol order for the next provider request.
   */
  providerTranscript?: Message[]
  categorization?: {
    speech: string
    reasoning: string
  }
}

export type ChatMessage = ChatAssistantMessage | SystemMessage | ToolMessage | UserMessage

/** Identifies one model-facing tool without storing its runtime executor. */
export interface ChatToolReference {
  name: string
}

/** Which branch answered one user turn. */
export type TurnRouteKind = 'urgent' | 'medical' | 'chat' | 'fallback'

/**
 * The branch record kept on the assistant message of one turn.
 *
 * It stays on the local session message. `buildProviderMessages` removes it
 * before composition, so a provider never sees it, and cloud sync keeps sending
 * only `role` and `content`.
 */
export interface TurnRoute {
  kind: TurnRouteKind
  /** Why a branch other than `chat` answered, such as a degraded classifier. */
  reason?: string
}

/**
 * What the router decides for one turn, before the model request is assembled.
 *
 * The caller owns both texts. The runtime does not know which part of a system
 * message is character prompt and which part is a shared format constraint, so
 * it replaces the message instead of editing it.
 */
export interface TurnRouteResult {
  route: TurnRoute
  /** The complete system message for this turn. Replaces the stored one. */
  systemPrompt?: string
  /** When present, the turn ends with this text and no model request. */
  reply?: string
  /**
   * Runs the turn without the general chat context.
   *
   * An isolated turn skips the registered runtime context providers and sends no
   * caller tools, so its prompt holds the same-session history, the routed
   * system message and the time information only. A `reply` turn is always
   * isolated.
   *
   * @default false
   */
  isolate?: boolean
}

export interface ErrorMessage {
  role: 'error'
  content: string
}

export interface ContextMessage extends ContextUpdate<Record<string, unknown>, unknown> {
  metadata?: {
    source: MetadataEventSource
  }
  createdAt: number
}

export type ChatHistoryItem = (ChatMessage | ErrorMessage) & {
  context?: ContextMessage
  createdAt?: number
  id?: string
  /** Tools selected for this message. The runtime rebuilds executors from these names. */
  tools?: ChatToolReference[]
  /** Which branch produced this assistant turn. Local only; never sent to a provider. */
  route?: TurnRoute
}

export interface ChatStreamEventContext {
  /** Stable correlation id shared by every hook emitted for one user turn. */
  turnId: string
  message: ChatHistoryItem
  contexts: Record<string, ContextMessage[]>
  composedMessage: Array<Message>
  input?: WebSocketEventInputs
}

export type ChatStreamEvent
  = | { type: 'before-compose', message: string, sessionId: string, context: Omit<ChatStreamEventContext, 'composedMessage'> }
    | { type: 'after-compose', message: string, sessionId: string, context: ChatStreamEventContext }
    | { type: 'before-send', message: string, sessionId: string, context: ChatStreamEventContext }
    | { type: 'after-send', message: string, sessionId: string, context: ChatStreamEventContext }
    | { type: 'token-literal', literal: string, sessionId: string, context: ChatStreamEventContext }
    | { type: 'token-special', special: string, sessionId: string, context: ChatStreamEventContext }
    | { type: 'stream-end', sessionId: string, context: ChatStreamEventContext }
    | { type: 'assistant-end', message: string, sessionId: string, context: ChatStreamEventContext }
    | { type: 'assistant-message', message: ChatAssistantMessage, sessionId: string, messageText: string, context: ChatStreamEventContext }

export type StreamingAssistantMessage = ChatAssistantMessage & { context?: ContextMessage } & { createdAt?: number, id?: string } & { route?: TurnRoute }
