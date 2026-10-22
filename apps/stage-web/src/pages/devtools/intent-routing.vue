<script setup lang="ts">
import type { ClassifyResult } from '@proj-airi/stage-ui/libs/intent/classify'
import type { IntentClassifierMode } from '@proj-airi/stage-ui/libs/intent/contract'

import { errorMessageFrom } from '@moeru/std'
import { classifyMessage } from '@proj-airi/stage-ui/libs/intent/classify'
import { useConsciousnessStore } from '@proj-airi/stage-ui/stores/modules/consciousness'
import { useProviderConfigStore } from '@proj-airi/stage-ui/stores/providers/config'
import { BasicTextarea, Button } from '@proj-airi/ui'
import { ref } from 'vue'

/**
 * Internal comparison page for the intent classifiers.
 *
 * It calls the classifiers directly and never goes through the chat store, so
 * nothing here can change a reply. It also stays out of a production build: a
 * page that spends the deployment's model credit must not be reachable by URL.
 */

const isDevelopment = import.meta.env.DEV

const modes: { value: IntentClassifierMode, label: string }[] = [
  { value: 'rules', label: '规则' },
  { value: 'model', label: 'DeepSeek' },
  { value: 'compare', label: '对比' },
]

const consciousnessStore = useConsciousnessStore()
const providerConfigStore = useProviderConfigStore()

const mode = ref<IntentClassifierMode>('rules')
const message = ref('宝宝黄疸怎么看')
const contextText = ref('')
const running = ref(false)
const failure = ref<string>()
const result = ref<ClassifyResult>()

function resolveModelOptions() {
  const providerId = consciousnessStore.activeProvider
  const config = providerId ? providerConfigStore.getProviderConfig(providerId) : undefined
  const baseURL = typeof config?.baseUrl === 'string' ? config.baseUrl : ''

  return {
    baseURL,
    apiKey: typeof config?.apiKey === 'string' ? config.apiKey : undefined,
    model: consciousnessStore.activeModel,
  }
}

async function run() {
  failure.value = undefined
  result.value = undefined

  if (!message.value.trim()) {
    failure.value = '请输入一条消息'
    return
  }

  running.value = true
  try {
    result.value = await classifyMessage({
      message: message.value,
      mode: mode.value,
      recentMessages: contextText.value.split('\n').map(line => line.trim()).filter(Boolean),
      model: resolveModelOptions(),
    })
  }
  catch (error) {
    failure.value = errorMessageFrom(error) ?? '分类失败'
  }
  finally {
    running.value = false
  }
}
</script>

<template>
  <div
    :class="[
      'min-h-full flex flex-col gap-4 pb-12',
    ]"
  >
    <div
      v-if="!isDevelopment"
      :class="[
        'rounded-2xl border px-4 py-3 text-sm',
        'bg-amber-50/70 border-amber-200 dark:bg-amber-950/30 dark:border-amber-900',
      ]"
    >
      意图识别评测页只在开发环境可用。
    </div>

    <template v-else>
      <div
        :class="[
          'flex flex-wrap items-center gap-2',
        ]"
      >
        <Button
          v-for="item in modes"
          :key="item.value"
          size="sm"
          :variant="mode === item.value ? 'primary' : 'secondary'"
          :label="item.label"
          @click="mode = item.value"
        />
        <span
          :class="[
            'text-xs text-neutral-500 dark:text-neutral-400',
          ]"
        >
          {{ consciousnessStore.activeProvider || '未配置 provider' }} / {{ consciousnessStore.activeModel || '未配置 model' }}
        </span>
      </div>

      <div
        :class="[
          'flex flex-col gap-2',
        ]"
      >
        <label
          :class="[
            'text-sm font-500',
          ]"
          for="intent-message"
        >
          待测文本
        </label>
        <BasicTextarea
          id="intent-message"
          v-model="message"
          :submit-on-enter="false"
          placeholder="输入一句话"
          :class="[
            'rounded-xl border px-3 py-2',
            'bg-white dark:bg-neutral-900',
            'border-neutral-200 dark:border-neutral-700',
          ]"
          min-h="[72px]"
          w-full
        />
      </div>

      <div
        :class="[
          'flex flex-col gap-2',
        ]"
      >
        <label
          :class="[
            'text-sm font-500',
          ]"
          for="intent-context"
        >
          上文（可选，每行一条，最多用最后两条）
        </label>
        <BasicTextarea
          id="intent-context"
          v-model="contextText"
          :submit-on-enter="false"
          placeholder="上一轮用户说了什么"
          :class="[
            'rounded-xl border px-3 py-2',
            'bg-white dark:bg-neutral-900',
            'border-neutral-200 dark:border-neutral-700',
          ]"
          min-h="[48px]"
          w-full
        />
      </div>

      <div>
        <Button
          :loading="running"
          :label="running ? '分类中…' : '分类'"
          icon="i-solar:play-circle-bold-duotone"
          @click="run"
        />
      </div>

      <div
        v-if="failure"
        :class="[
          'rounded-2xl border px-4 py-3 text-sm',
          'bg-red-50/70 border-red-200 text-red-700 dark:bg-red-950/30 dark:border-red-900 dark:text-red-300',
        ]"
      >
        {{ failure }}
      </div>

      <div
        v-if="result && result.mode !== 'compare'"
        :class="[
          'flex flex-col gap-1 rounded-2xl border px-4 py-3 text-sm',
          'bg-white dark:bg-neutral-900',
          'border-neutral-200 dark:border-neutral-700',
        ]"
      >
        <div :class="['font-600']">
          {{ result.decision.decision === 'medical' ? '医学问题' : '闲聊' }} · {{ result.decision.scene }}
        </div>
        <div :class="['text-neutral-500 dark:text-neutral-400']">
          source={{ result.decision.source }}
          · codes={{ result.decision.evidenceCodes.join(', ') || '无' }}
          · v{{ result.decision.classifierVersion }}
        </div>
      </div>

      <template v-if="result && result.mode === 'compare'">
        <div
          :class="[
            'rounded-2xl border px-4 py-3 text-sm',
            result.comparison.sameDecision
              ? 'bg-green-50/70 border-green-200 dark:bg-green-950/30 dark:border-green-900'
              : 'bg-amber-50/70 border-amber-200 dark:bg-amber-950/30 dark:border-amber-900',
          ]"
        >
          {{ result.comparison.sameDecision ? '两个分类器一致' : '两个分类器不一致' }}
        </div>

        <div
          :class="[
            'grid grid-cols-1 gap-3 md:grid-cols-2',
          ]"
        >
          <div
            v-for="side in [
              { key: 'rules', title: '规则', value: result.comparison.rules, duration: result.comparison.durationMs.rules },
              { key: 'model', title: 'DeepSeek', value: result.comparison.model, duration: result.comparison.durationMs.model },
            ]"
            :key="side.key"
            :class="[
              'flex flex-col gap-1 rounded-2xl border px-4 py-3 text-sm',
              'bg-white dark:bg-neutral-900',
              'border-neutral-200 dark:border-neutral-700',
            ]"
          >
            <div :class="['font-600']">
              {{ side.title }} · {{ side.value.decision === 'medical' ? '医学问题' : '闲聊' }}
            </div>
            <div :class="['text-neutral-500 dark:text-neutral-400']">
              scene={{ side.value.scene }}
            </div>
            <div :class="['text-neutral-500 dark:text-neutral-400']">
              source={{ side.value.source }}
            </div>
            <div :class="['text-neutral-500 dark:text-neutral-400']">
              codes={{ side.value.evidenceCodes.join(', ') || '无' }}
            </div>
            <div :class="['text-neutral-500 dark:text-neutral-400']">
              {{ side.duration.toFixed(1) }} ms
            </div>
          </div>
        </div>
      </template>
    </template>
  </div>
</template>

<route lang="yaml">
name: IntentRoutingDevtools
meta:
  layout: settings
</route>
