<script setup lang="ts">
import type { ChatAssistantMessage, ChatHistoryItem, ChatSlices, ChatSlicesText, ChatSlicesToolCallResult, TurnRoute } from '../../../../types/chat'
import type { ChatToolCallRendererRegistry } from './tool-call-renderer'

import { isStageCapacitor, isStageWeb } from '@proj-airi/stage-shared'
import { computed, ref } from 'vue'

import ChatResponsePart from './response-part.vue'
import ChatToolCallBlock from './tool-call-block.vue'

import { MarkdownRenderer } from '../../../markdown'
import { routeBadgeOf, routeDetailBranchOf, routeDetailReasonOf, routeNoticeOf } from '../route-copy'
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

/** True when this turn answered with the emergency instruction. */
const isUrgent = computed(() => props.route?.kind === 'urgent')

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
    ? ['px-2 py-2 text-sm']
    : ['px-3 py-3'],
  // An emergency answer is a card of its own: it leads with the action, and a
  // reader who is worried should not have to pick it out of a tinted bubble.
  isUrgent.value
    ? ['border border-red-300 bg-red-50/80 dark:border-red-900 dark:bg-red-950/40']
    : [props.variant === 'mobile'
        ? 'bg-primary-50/60 backdrop-blur-xl dark:bg-primary-950/60'
        : 'bg-primary-50/80 dark:bg-primary-950/75'],
  routeAccentClass.value,
])
const copyText = computed(() => getChatHistoryItemCopyText(props.message as ChatHistoryItem))

// The branch copy and the reason wording live in `../route-copy`, so the
// policy can be tested without mounting a chat page.
const routeBadge = computed(() => routeBadgeOf(props.route))
const routeNotice = computed(() => routeNoticeOf(props.route))
const detailBranch = computed(() => routeDetailBranchOf(props.route))
const detailReason = computed(() => routeDetailReasonOf(props.route))

const detailsOpen = ref(false)
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
          <!-- The action comes before the paragraph, and the words carry it:
               a reader who cannot separate red from grey still reads "立即就医". -->
          <div
            v-if="isUrgent"
            :class="[
              'flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-600 leading-none text-white',
              'bg-red-600 dark:bg-red-500',
            ]"
          >
            <span :class="['i-solar:danger-triangle-bold-duotone', 'text-sm']" />
            立即就医 · 请前往急诊或拨打 120
          </div>
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
          <!-- A routed turn says which branch answered, on demand. The detail
               stays collapsed: it is a fact the reader may want, not a banner. -->
          <div v-if="detailBranch" :class="['flex flex-col gap-1']">
            <button
              type="button"
              :aria-expanded="detailsOpen"
              :class="[
                'w-fit text-[10px] underline decoration-dotted underline-offset-2',
                'text-neutral-500 dark:text-neutral-400',
              ]"
              @click="detailsOpen = !detailsOpen"
            >
              {{ detailsOpen ? '收起详情' : '详情' }}
            </button>

            <dl
              v-if="detailsOpen"
              :class="[
                'grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 rounded-lg px-2 py-1.5 text-[10px]',
                'bg-neutral-100/70 dark:bg-neutral-800/60',
              ]"
            >
              <dt :class="['text-neutral-500 dark:text-neutral-400']">
                分支
              </dt>
              <dd>{{ detailBranch }}</dd>

              <template v-if="detailReason">
                <dt :class="['text-neutral-500 dark:text-neutral-400']">
                  原因
                </dt>
                <dd>{{ detailReason }}</dd>
              </template>
            </dl>
          </div>
        </div>
      </template>
    </ChatActionMenu>
  </div>
</template>
