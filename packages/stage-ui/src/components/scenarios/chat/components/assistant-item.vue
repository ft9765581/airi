<script setup lang="ts">
import type { ChatAssistantMessage, ChatHistoryItem, ChatSlices, ChatSlicesText, ChatSlicesToolCallResult, TurnRoute } from '../../../../types/chat'
import type { ChatToolCallRendererRegistry } from './tool-call-renderer'

import { isStageCapacitor, isStageWeb } from '@proj-airi/stage-shared'
import { computed } from 'vue'

import ChatResponsePart from './response-part.vue'
import ChatToolCallBlock from './tool-call-block.vue'

import { MarkdownRenderer } from '../../../markdown'
import { getChatHistoryItemCopyText } from '../utils'
import { ChatActionMenu } from './action-menu'
import { createToolCallResultLookup, resolveToolCallBlockState } from './tool-call-results'

const props = withDefaults(defineProps<{
  message: ChatAssistantMessage
  label: string
  scrollContainer?: HTMLElement | null
  showPlaceholder?: boolean
  variant?: 'desktop' | 'mobile'
  toolCallRenderers?: ChatToolCallRendererRegistry
  /** Which branch answered this turn. Absent for a normal chat answer. */
  route?: TurnRoute
}>(), {
  showPlaceholder: false,
  scrollContainer: null,
  variant: 'desktop',
  toolCallRenderers: () => ({}),
  route: undefined,
})

const emit = defineEmits<{
  (e: 'copy'): void
  (e: 'delete'): void
  (e: 'toolCallRerun', payload: { toolCallId: string, toolName: string, args: string }): void
}>()

const resolvedSlices = computed<ChatSlices[]>(() => {
  if (props.message.slices?.length) {
    return props.message.slices
  }

  if (typeof props.message.content === 'string' && props.message.content.trim()) {
    return [{ type: 'text', text: props.message.content } satisfies ChatSlicesText]
  }

  if (Array.isArray(props.message.content)) {
    const textPart = props.message.content.find(part => 'type' in part && part.type === 'text') as { text?: string } | undefined
    if (textPart?.text)
      return [{ type: 'text', text: textPart.text } satisfies ChatSlicesText]
  }

  return []
})

const toolResultById = computed(() => {
  return createToolCallResultLookup(resolvedSlices.value, props.message.tool_results)
})

function getToolCallResult(slice: ChatSlices): ChatSlicesToolCallResult | undefined {
  if (slice.type !== 'tool-call') {
    return undefined
  }

  return toolResultById.value.get(slice.toolCall.toolCallId)
}

function getToolCallState(slice: ChatSlices): 'executing' | 'done' | 'error' {
  return resolveToolCallBlockState(getToolCallResult(slice))
}

function getToolCallRenderer(slice: ChatSlices) {
  if (slice.type !== 'tool-call') {
    return ChatToolCallBlock
  }

  return props.toolCallRenderers[slice.toolCall.toolName] ?? ChatToolCallBlock
}

const showLoader = computed(() => props.showPlaceholder && resolvedSlices.value.length === 0)
const containerClass = computed(() => props.variant === 'mobile' ? 'mr-0' : 'mr-12')

/**
 * A visible edge for the branches that answer differently.
 *
 * The badge alone is easy to miss in a long history, so a routed turn also gets
 * an accent on the side of the bubble. A normal chat answer keeps the plain box.
 */
const routeAccentClass = computed(() => {
  switch (props.route?.kind) {
    case 'medical':
      return 'border-l-4 border-l-teal-400/70'
    case 'urgent':
      return 'border-l-4 border-l-red-500'
    case 'fallback':
      return 'border-l-4 border-l-neutral-400'
    default:
      return undefined
  }
})

const boxClasses = computed(() => [
  props.variant === 'mobile'
    ? ['px-2 py-2 text-sm', 'bg-primary-50/60 backdrop-blur-xl dark:bg-primary-950/60']
    : ['px-3 py-3', 'bg-primary-50/80 dark:bg-primary-950/75'],
  routeAccentClass.value,
])
const copyText = computed(() => getChatHistoryItemCopyText(props.message as ChatHistoryItem))

/**
 * The label of the branches that must stand out at a glance.
 *
 * A normal medical answer carries the notice under the text instead, so it needs
 * no tag. Emergency guidance keeps its tag, because the reader has to see it
 * before reading the paragraph.
 */
const routeBadge = computed(() => {
  switch (props.route?.kind) {
    case 'urgent':
      return {
        text: '急诊指引',
        class: 'border-red-300 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300',
      }
    case 'fallback':
      return {
        text: '兜底回复',
        class: 'border-neutral-300 bg-neutral-100 text-neutral-600 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300',
      }
    default:
      return undefined
  }
})

/**
 * The line under a routed answer.
 *
 * The badge says which branch answered; this line says what the person must not
 * conclude from it. It sits under the text, because a reader who finishes the
 * answer is the one who needs it, and a small label at the top is easy to miss.
 */
const routeNotice = computed(() => {
  switch (props.route?.kind) {
    case 'medical':
      return {
        text: '以上是普通健康指引，不能替代医生诊断。症状加重或出现紧急情况，请立即就医。',
        class: 'text-neutral-500 dark:text-neutral-400',
      }
    case 'urgent':
      return {
        text: '以上不是诊断结论。请立即前往急诊或拨打 120。',
        class: 'text-red-700 dark:text-red-300',
      }
    case 'fallback':
      return {
        text: '这一轮没有生成医疗回答，以上是固定回复。',
        class: 'text-neutral-500 dark:text-neutral-400',
      }
    default:
      return undefined
  }
})
</script>

<template>
  <div flex :class="['font-cute', containerClass]" class="ph-no-capture">
    <ChatActionMenu
      :copy-text="copyText"
      :can-delete="!showPlaceholder"
      :scroll-container="scrollContainer"
      @copy="emit('copy')"
      @delete="emit('delete')"
    >
      <template #default="{ setMeasuredElement }">
        <div
          :ref="setMeasuredElement"
          flex="~ col" shadow="sm primary-200/50 dark:none"
          min-w-20 gap-2 rounded-xl h="unset <sm:fit"
          :data-route-kind="route?.kind ?? 'chat'"
          :class="[
            'chat-message-item-container',
            boxClasses,
            (isStageWeb() || isStageCapacitor()) && props.variant === 'mobile' ? 'select-none sm:select-auto' : '',
          ]"
        >
          <ChatResponsePart
            v-if="message.categorization"
            :message="message"
            :variant="variant"
          />
          <div class="<sm:hidden">
            <span text-sm text="black/60 dark:white/65" font-normal>{{ label }}</span>
          </div>
          <span
            v-if="routeBadge"
            :class="[
              'w-fit rounded-full border px-2 py-0.5 text-[10px] font-500 leading-none',
              routeBadge.class,
            ]"
          >
            {{ routeBadge.text }}
          </span>
          <div v-if="resolvedSlices.length > 0" class="flex flex-col gap-2 break-words" text="primary-700 dark:primary-100">
            <template v-for="(slice, sliceIndex) in resolvedSlices" :key="sliceIndex">
              <component
                :is="getToolCallRenderer(slice)"
                v-if="slice.type === 'tool-call'"
                :tool-call-id="slice.toolCall.toolCallId"
                :tool-name="slice.toolCall.toolName"
                :args="slice.toolCall.args"
                :state="getToolCallState(slice)"
                :result="getToolCallResult(slice)?.result"
                @tool-call-rerun="emit('toolCallRerun', $event)"
              />
              <template v-else-if="slice.type === 'tool-call-result'" />
              <template v-else-if="slice.type === 'text'">
                <MarkdownRenderer :content="slice.text" />
              </template>
            </template>
          </div>
          <div v-else-if="showLoader" i-eos-icons:three-dots-loading />
          <p
            v-if="routeNotice"
            :class="[
              'border-t border-neutral-200/70 pt-1.5 text-[10px] leading-snug dark:border-neutral-700/70',
              routeNotice.class,
            ]"
          >
            {{ routeNotice.text }}
          </p>
        </div>
      </template>
    </ChatActionMenu>
  </div>
</template>
