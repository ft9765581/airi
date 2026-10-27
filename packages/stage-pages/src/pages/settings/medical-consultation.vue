<script setup lang="ts">
import type { MedicalPreviewResult } from '@proj-airi/stage-ui/libs/intent/preview'
import type { MedicalAgentConfig } from '@proj-airi/stage-ui/libs/intent/route'

import { errorMessageFrom } from '@moeru/std'
import { allowsMedicalGeneration, parseMedicalGenerationMode } from '@proj-airi/stage-ui/libs/intent/medical-generation'
import { medicalBehaviorConstraints } from '@proj-airi/stage-ui/libs/intent/medical-prompt'
import { previewMedicalTurn } from '@proj-airi/stage-ui/libs/intent/preview'
import { medicalAgentProblem } from '@proj-airi/stage-ui/libs/intent/route'
import { useAiriCardStore } from '@proj-airi/stage-ui/stores/modules/airi-card'
import { useConsciousnessStore } from '@proj-airi/stage-ui/stores/modules/consciousness'
import { BasicTextarea, Button, Checkbox } from '@proj-airi/ui'
import {
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogOverlay,
  AlertDialogPortal,
  AlertDialogRoot,
  AlertDialogTitle,
} from 'reka-ui'
import { computed, ref, watch } from 'vue'
import { onBeforeRouteLeave } from 'vue-router'

/**
 * Medical consultation settings for the active character card.
 *
 * The page owns only the card layer: whether this card is willing to use the
 * medical agent, and the persona it speaks with. The deployment switch stays in
 * the build configuration, because a card can be imported from anywhere and the
 * deployment is the side that answers for what it generates.
 */

const cardStore = useAiriCardStore()
const consciousnessStore = useConsciousnessStore()

const mode = parseMedicalGenerationMode(import.meta.env.VITE_MEDICAL_GENERATION)
const generationAllowed = allowsMedicalGeneration(mode, { isDevelopment: import.meta.env.DEV })

const activeCard = computed(() => cardStore.activeCard)
const savedAgent = computed<MedicalAgentConfig | undefined>(() => activeCard.value?.extensions?.airi?.agents?.medical)

/** What the card holds now, which is what "unsaved changes" compares against. */
function storedAgent() {
  return {
    enabled: savedAgent.value?.enabled === true,
    prompt: savedAgent.value?.prompt ?? '',
  }
}

const enabled = ref(storedAgent().enabled)
const prompt = ref(storedAgent().prompt)
const savedAt = ref<number>()
const failure = ref<string>()

/**
 * What the form was last loaded from or saved to.
 *
 * Comparing the form against the card would read a switch between two different
 * cards as an edit, so the comparison uses this copy instead.
 */
let loaded = { ...storedAgent() }

const dirty = computed(() => enabled.value !== loaded.enabled || prompt.value !== loaded.prompt)

/** Set when a card switch threw away an edit that was not saved. */
const draftDiscarded = ref(false)

/** Holds the navigation until the person answers the unsaved-changes prompt. */
let pendingLeave: ((leave: boolean) => void) | undefined
const leaveDialogOpen = ref(false)

// A card switch replaces the form, because the settings belong to that card. An
// edit in progress is dropped on purpose: applying it to another character would
// write one persona onto another. The page says so instead of dropping it
// silently, and it watches the card id rather than its name, because two cards
// can share a name.
watch(() => cardStore.activeCardId, () => {
  draftDiscarded.value = dirty.value

  const stored = storedAgent()
  enabled.value = stored.enabled
  prompt.value = stored.prompt
  loaded = { ...stored }
  savedAt.value = undefined
  failure.value = undefined
})

const deploymentStatus = computed(() => {
  if (mode === 'off')
    return 'off：不生成医疗回答，只走固定回复'
  if (mode === 'dev')
    return generationAllowed ? 'dev：当前开发构建已开启生成' : 'dev：只在开发构建生效，当前构建未开启'
  return 'on：任何构建都会生成医疗回答'
})

/** Every reason this card cannot generate right now, in the order a person fixes them. */
const blockers = computed(() => {
  const reasons: string[] = []

  if (!generationAllowed)
    reasons.push('部署开关未开启（VITE_MEDICAL_GENERATION）')

  const problem = medicalAgentProblem(savedAgent.value)
  if (problem === 'agent_missing')
    reasons.push('这张角色卡还没有填写医疗配置')
  if (problem === 'agent_disabled')
    reasons.push('医疗助手开关是关闭的')
  if (problem === 'prompt_empty')
    reasons.push('医疗提示词是空的')

  // The config can allow the branch while the runtime still has no model to
  // answer with, and those are different fixes. Only warn about the model when
  // the card layer is ready, so the list stays ordered by what to do first.
  if (!reasons.length && (!consciousnessStore.activeProvider || !consciousnessStore.activeModel))
    reasons.push('没有选中的聊天模型')

  return reasons
})

const previewMessage = ref('宝宝黄疸怎么看')
const previewing = ref(false)
const previewResult = ref<MedicalPreviewResult>()
const previewError = ref<string>()

/**
 * Why the preview cannot run, read from the draft rather than the saved card.
 *
 * The draft is what the person is trying to test, so previewing the saved value
 * would answer a different question than the one on screen.
 */
const previewBlockers = computed(() => {
  const reasons: string[] = []

  if (!generationAllowed)
    reasons.push('部署开关未开启（VITE_MEDICAL_GENERATION）')
  if (!enabled.value)
    reasons.push('医疗助手开关是关闭的')
  if (!prompt.value.trim())
    reasons.push('医疗提示词是空的')
  if (!consciousnessStore.activeProvider || !consciousnessStore.activeModel)
    reasons.push('没有选中的聊天模型')

  return reasons
})

/** The branch the router chose, named the way the reader sees it. */
const previewBranch = computed(() => {
  switch (previewResult.value?.route.kind) {
    case 'urgent':
      return '急诊指引'
    case 'medical':
      return '医疗咨询'
    case 'fallback':
      return '兜底回复'
    default:
      return '普通聊天'
  }
})

async function runPreview() {
  const providerId = consciousnessStore.activeProvider
  const model = consciousnessStore.activeModel
  if (!providerId || !model) {
    previewError.value = '没有选中的聊天模型'
    return
  }

  previewing.value = true
  previewResult.value = undefined
  previewError.value = undefined

  try {
    const provider = await consciousnessStore.getChatProviderInstance(providerId)
    previewResult.value = await previewMedicalTurn({
      message: previewMessage.value,
      // The draft, not the saved card: the preview exists to test what is here.
      agent: { enabled: enabled.value, prompt: prompt.value },
      allowGeneration: generationAllowed,
      request: provider.chat(model),
    })
  }
  catch (error) {
    previewError.value = errorMessageFrom(error)
  }
  finally {
    previewing.value = false
  }
}

async function save() {
  failure.value = undefined

  const saved = await cardStore.updateActiveCardMedicalAgent({ enabled: enabled.value, prompt: prompt.value })
  if (!saved) {
    failure.value = '当前角色卡不可写，请先选择一个角色卡'
    return
  }

  // The store normalises the value, so read it back instead of trusting the form.
  loaded = { ...storedAgent() }
  draftDiscarded.value = false
  savedAt.value = Date.now()
}

function clearPrompt() {
  prompt.value = ''
}

onBeforeRouteLeave(() => {
  if (!dirty.value)
    return true

  // The router waits for this promise, so the dialog decides whether the page
  // closes. A pending answer is resolved once, by either button.
  return new Promise<boolean>((resolve) => {
    pendingLeave = resolve
    leaveDialogOpen.value = true
  })
})

function resolveLeave(leave: boolean) {
  leaveDialogOpen.value = false
  pendingLeave?.(leave)
  pendingLeave = undefined
}
</script>

<template>
  <div :class="['flex flex-col gap-4 pb-12']">
    <section
      :class="[
        'flex flex-col gap-2 rounded-2xl border px-4 py-3 text-sm',
        'bg-white dark:bg-neutral-900',
        'border-neutral-200 dark:border-neutral-700',
      ]"
    >
      <h2 :class="['text-base font-600']">
        状态
      </h2>

      <dl :class="['grid grid-cols-1 gap-1 sm:grid-cols-[10rem_1fr]']">
        <dt :class="['text-neutral-500 dark:text-neutral-400']">
          部署开关
        </dt>
        <dd>{{ deploymentStatus }}</dd>

        <dt :class="['text-neutral-500 dark:text-neutral-400']">
          当前角色卡
        </dt>
        <dd>{{ activeCard?.name || '未选择角色卡' }}</dd>

        <dt :class="['text-neutral-500 dark:text-neutral-400']">
          当前咨询模型
        </dt>
        <dd>{{ consciousnessStore.activeModel || '未配置模型' }}</dd>
      </dl>

      <!-- Only the blocking state is shown. A green "all good" line told the
           reader nothing they could not check by sending one message, and it
           claimed more than this page can know. -->
      <p
        v-if="blockers.length"
        :class="[
          'rounded-xl border px-3 py-2 text-xs',
          'border-amber-200 bg-amber-50/70 text-amber-700',
          'dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300',
        ]"
      >
        医疗生成会被拦截：{{ blockers.join('；') }}
      </p>
    </section>

    <section
      :class="[
        'flex flex-col gap-3 rounded-2xl border px-4 py-3 text-sm',
        'bg-white dark:bg-neutral-900',
        'border-neutral-200 dark:border-neutral-700',
      ]"
    >
      <h2 :class="['text-base font-600']">
        医疗助手人格
      </h2>

      <label :class="['flex items-center gap-3']">
        <Checkbox v-model="enabled" />
        <span>让这张角色卡在医疗问题里使用医疗助手</span>
      </label>

      <p :class="['text-xs text-neutral-500 dark:text-neutral-400']">
        开关只表示这张卡愿意使用。是否真的生成还取决于部署开关，以及提示词是否填写。
      </p>

      <BasicTextarea
        v-model="prompt"
        :submit-on-enter="false"
        placeholder="例如：你是产后康复顾问，称呼对方为宝妈，说话简短具体。"
        :class="[
          'rounded-xl border px-3 py-2',
          'bg-white dark:bg-neutral-900',
          'border-neutral-200 dark:border-neutral-700',
        ]"
        min-h="[160px]"
        w-full
      />

      <div :class="['flex flex-wrap items-center gap-2']">
        <Button size="sm" variant="secondary" label="清空提示词" @click="clearPrompt" />
        <span :class="['text-xs text-neutral-500 dark:text-neutral-400']">
          只描述人格、称呼和语气。诊断与用药限制由下面的约束负责，写在这里也不会被采纳。
        </span>
      </div>
    </section>

    <section
      :class="[
        'flex flex-col gap-2 rounded-2xl border px-4 py-3 text-sm',
        'bg-neutral-50 dark:bg-neutral-950/40',
        'border-neutral-200 dark:border-neutral-700',
      ]"
    >
      <h2 :class="['text-base font-600']">
        应用行为约束（只读）
      </h2>

      <p :class="['text-xs text-neutral-500 dark:text-neutral-400']">
        这段由应用维护，角色卡不能覆盖。医疗轮次的系统消息是「通用格式约束 + 这段约束 + 你的提示词」。
      </p>

      <pre :class="['overflow-x-auto whitespace-pre-wrap break-words font-mono text-xs leading-relaxed']">{{ medicalBehaviorConstraints }}</pre>
    </section>

    <section
      :class="[
        'flex flex-col gap-3 rounded-2xl border px-4 py-3 text-sm',
        'bg-white dark:bg-neutral-900',
        'border-neutral-200 dark:border-neutral-700',
      ]"
    >
      <h2 :class="['text-base font-600']">
        预览
      </h2>

      <p :class="['text-xs text-neutral-500 dark:text-neutral-400']">
        预览复用正式的分流判定与提示词组装，读的是上面的草稿，不需要先保存。它不写入聊天会话，
        也不触发记忆、绘图或云同步；但会真实消耗模型调用（分类一次，生成一次）。
      </p>

      <BasicTextarea
        v-model="previewMessage"
        :submit-on-enter="false"
        placeholder="例如：宝宝黄疸怎么看"
        :class="[
          'rounded-xl border px-3 py-2',
          'bg-white dark:bg-neutral-900',
          'border-neutral-200 dark:border-neutral-700',
        ]"
        min-h="[80px]"
        w-full
      />

      <div :class="['flex flex-wrap items-center gap-2']">
        <Button
          size="sm"
          :disabled="previewing || previewBlockers.length > 0"
          :label="previewing ? '预览中…' : '预览'"
          @click="runPreview"
        />

        <span v-if="previewBlockers.length" :class="['text-xs text-amber-700 dark:text-amber-400']">
          不能预览：{{ previewBlockers.join('；') }}
        </span>
        <span v-else :class="['text-xs text-neutral-500 dark:text-neutral-400']">
          使用草稿，不必先保存
        </span>
      </div>

      <span v-if="previewError" :class="['text-xs text-red-600 dark:text-red-400']">{{ previewError }}</span>

      <template v-if="previewResult">
        <div :class="['text-xs']">
          <span :class="['text-neutral-500 dark:text-neutral-400']">本轮分支：</span>{{ previewBranch }}<span
            v-if="previewResult.route.reason"
            :class="['text-neutral-500 dark:text-neutral-400']"
          >（{{ previewResult.route.reason }}）</span>
        </div>

        <p
          v-if="previewResult.reply"
          :class="['rounded-xl border px-3 py-2', 'border-neutral-200 dark:border-neutral-700']"
        >
          {{ previewResult.reply }}
        </p>
        <p v-else-if="previewResult.answer" :class="['whitespace-pre-wrap leading-relaxed']">
          {{ previewResult.answer }}
        </p>
        <p v-else-if="previewResult.failure" :class="['text-xs text-red-600 dark:text-red-400']">
          预览没有拿到回答：{{ previewResult.failure }}
        </p>
        <p v-else :class="['text-xs text-neutral-500 dark:text-neutral-400']">
          这条消息不会进入医疗分支，所以没有咨询回答可预览。
        </p>

        <p :class="['text-xs text-neutral-500 dark:text-neutral-400']">
          预览结果只显示在这里，不会写入聊天会话。
        </p>
      </template>
    </section>

    <section :class="['flex flex-wrap items-center gap-3']">
      <Button :disabled="!dirty" :label="dirty ? '保存' : (savedAt ? '已保存' : '没有改动')" @click="save" />

      <span v-if="savedAt" :class="['text-xs text-green-700 dark:text-green-400']">
        已保存到当前角色卡
      </span>
      <span v-else-if="dirty" :class="['text-xs text-neutral-500 dark:text-neutral-400']">
        有未保存的改动
      </span>

      <span v-if="failure" :class="['text-xs text-red-600 dark:text-red-400']">
        {{ failure }}
      </span>

      <span v-if="draftDiscarded" :class="['text-xs text-amber-700 dark:text-amber-400']">
        切换角色卡时丢弃了未保存的改动
      </span>
    </section>

    <p :class="['text-xs text-neutral-500 dark:text-neutral-400']">
      保存后，切换到别的角色卡再切回来，配置会跟着卡片走。
    </p>

    <AlertDialogRoot :open="leaveDialogOpen" @update:open="value => !value && resolveLeave(false)">
      <AlertDialogPortal>
        <AlertDialogOverlay class="fixed inset-0 z-100 bg-black/50 data-[state=closed]:animate-fadeOut data-[state=open]:animate-fadeIn" />
        <AlertDialogContent
          class="fixed left-1/2 top-1/2 z-100 max-w-md w-full border border-neutral-200 rounded-xl bg-white p-6 shadow-xl -translate-x-1/2 -translate-y-1/2 data-[state=closed]:animate-contentHide data-[state=open]:animate-contentShow dark:border-neutral-700 dark:bg-neutral-800"
          @interact-outside.prevent
        >
          <AlertDialogTitle class="mb-4 text-xl font-normal">
            有未保存的改动
          </AlertDialogTitle>
          <AlertDialogDescription class="mb-6">
            离开后，这次填写的医疗提示词和开关不会保存到角色卡。
          </AlertDialogDescription>

          <div class="flex flex-row justify-end gap-3">
            <AlertDialogCancel as-child>
              <Button label="留在本页" @click="resolveLeave(false)" />
            </AlertDialogCancel>
            <AlertDialogAction as-child>
              <Button label="不保存，离开" variant="primary" @click="resolveLeave(true)" />
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialogPortal>
    </AlertDialogRoot>
  </div>
</template>

<route lang="yaml">
meta:
  layout: settings
  # Listed on `/settings` so the page is reachable without knowing its path.
  settingsEntry: true
  order: 80
  title: 医疗咨询
  description: 配置当前角色卡的医疗助手开关与提示词
  icon: i-solar:health-bold-duotone
</route>
