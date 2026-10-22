<script setup lang="ts">
import type { ClassifyResult } from '@proj-airi/stage-ui/libs/intent/classify'
import type { IntentClassifierMode, IntentDecision } from '@proj-airi/stage-ui/libs/intent/contract'
import type { EvaluationReport, IntentSampleGroup } from '@proj-airi/stage-ui/libs/intent/evaluate'

import { errorMessageFrom } from '@moeru/std'
import { classifyMessage } from '@proj-airi/stage-ui/libs/intent/classify'
import { evaluateSamples } from '@proj-airi/stage-ui/libs/intent/evaluate'
import { intentSampleGroupLabels, intentSamples } from '@proj-airi/stage-ui/libs/intent/fixtures'
import { useConsciousnessStore } from '@proj-airi/stage-ui/stores/modules/consciousness'
import { useProviderConfigStore } from '@proj-airi/stage-ui/stores/providers/config'
import { BasicTextarea, Button } from '@proj-airi/ui'
import { ref } from 'vue'

/**
 * Internal comparison page for the intent classifiers.
 *
 * Three things live here: one message at a time, the labelled evaluation set,
 * and the runs that just happened. It calls the classifiers directly and never
 * goes through the chat store, so nothing here can change a reply. It also
 * renders only in a development build: a page that spends the deployment's
 * model credit must not be reachable by URL in production.
 */

const isDevelopment = import.meta.env.DEV

const modes: { value: IntentClassifierMode, label: string }[] = [
  { value: 'rules', label: '规则' },
  { value: 'model', label: 'DeepSeek' },
  { value: 'compare', label: '对比' },
]

/** One single-message run, kept so a result can be compared with the last one. */
interface TestRecord {
  at: number
  mode: IntentClassifierMode
  input: string
  rules?: IntentDecision
  model?: IntentDecision
  sameDecision?: boolean
  durationMs: number
}

/** Keeps the table readable during a long session. */
const maxRecords = 50

const consciousnessStore = useConsciousnessStore()
const providerConfigStore = useProviderConfigStore()

const mode = ref<IntentClassifierMode>('rules')
const message = ref('宝宝黄疸怎么看')
const contextText = ref('')
const running = ref(false)
const evaluating = ref(false)
const failure = ref<string>()
const result = ref<ClassifyResult>()
const report = ref<EvaluationReport>()
const records = ref<TestRecord[]>([])

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

function currentContext() {
  return contextText.value.split('\n').map(line => line.trim()).filter(Boolean)
}

function percent(value: number) {
  return `${(value * 100).toFixed(1)}%`
}

function modelGroup(group: IntentSampleGroup) {
  return report.value?.model?.groups.find(item => item.group === group)
}

function pushRecord(entry: TestRecord) {
  records.value = [entry, ...records.value].slice(0, maxRecords)
}

async function run() {
  failure.value = undefined
  result.value = undefined

  if (!message.value.trim()) {
    failure.value = '请输入一条消息'
    return
  }

  running.value = true
  const startedAt = performance.now()
  try {
    const outcome = await classifyMessage({
      message: message.value,
      mode: mode.value,
      recentMessages: currentContext(),
      model: resolveModelOptions(),
    })
    result.value = outcome

    const durationMs = performance.now() - startedAt
    pushRecord(outcome.mode === 'compare'
      ? {
          at: Date.now(),
          mode: outcome.mode,
          input: message.value,
          rules: outcome.comparison.rules,
          model: outcome.comparison.model,
          sameDecision: outcome.comparison.sameDecision,
          durationMs,
        }
      : {
          at: Date.now(),
          mode: outcome.mode,
          input: message.value,
          rules: outcome.mode === 'rules' ? outcome.decision : undefined,
          model: outcome.mode === 'model' ? outcome.decision : undefined,
          durationMs,
        })
  }
  catch (error) {
    failure.value = errorMessageFrom(error) ?? '分类失败'
  }
  finally {
    running.value = false
  }
}

async function runEvaluation() {
  failure.value = undefined
  evaluating.value = true
  try {
    report.value = await evaluateSamples({
      samples: intentSamples,
      mode: mode.value,
      model: resolveModelOptions(),
    })
  }
  catch (error) {
    failure.value = errorMessageFrom(error) ?? '评测失败'
  }
  finally {
    evaluating.value = false
  }
}

function overviewMetrics() {
  const current = report.value
  if (!current)
    return []

  return [
    { label: '规则召回', value: percent(current.rules.medicalRecall) },
    { label: '规则误判', value: percent(current.rules.chatFalsePositiveRate) },
    { label: '模型召回', value: current.model ? percent(current.model.medicalRecall) : '未运行' },
    { label: '模型误判', value: current.model ? percent(current.model.chatFalsePositiveRate) : '未运行' },
    { label: '模型失败率', value: current.model ? percent(current.model.fallbackRate) : '未运行' },
    { label: '规则耗时', value: `${current.durationMs.rules.toFixed(0)} ms` },
    { label: '模型耗时', value: current.durationMs.model === undefined ? '未运行' : `${current.durationMs.model.toFixed(0)} ms` },
    { label: '两边都不对', value: `${current.unmatched.length} 条` },
  ]
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

      <div
        :class="[
          'flex flex-wrap items-center gap-2',
        ]"
      >
        <Button
          :loading="running"
          :label="running ? '分类中…' : '分类这一句'"
          icon="i-solar:play-circle-bold-duotone"
          @click="run"
        />
        <Button
          :loading="evaluating"
          :label="evaluating ? '评测中…' : `跑测试集（${intentSamples.length} 条）`"
          icon="i-solar:chart-2-bold-duotone"
          variant="secondary"
          @click="runEvaluation"
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
              scene={{ side.value.scene }} · source={{ side.value.source }}
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

      <template v-if="report">
        <h2 :class="['text-base font-600']">
          测试集结果 · {{ report.total }} 条 · 模式 {{ report.mode }}
        </h2>

        <div
          :class="[
            'grid grid-cols-2 gap-3 md:grid-cols-4',
          ]"
        >
          <div
            v-for="metric in overviewMetrics()"
            :key="metric.label"
            :class="[
              'flex flex-col gap-1 rounded-xl border px-3 py-2',
              'bg-white dark:bg-neutral-900',
              'border-neutral-200 dark:border-neutral-700',
            ]"
          >
            <span :class="['text-xs text-neutral-500 dark:text-neutral-400']">{{ metric.label }}</span>
            <span :class="['text-sm font-600']">{{ metric.value }}</span>
          </div>
        </div>

        <div
          :class="[
            'overflow-x-auto rounded-2xl border',
            'border-neutral-200 dark:border-neutral-700',
          ]"
        >
          <table :class="['w-full text-left text-sm']">
            <thead :class="['bg-neutral-50 dark:bg-neutral-900']">
              <tr>
                <th :class="['px-3 py-2 font-500']">
                  分组
                </th>
                <th :class="['px-3 py-2 font-500']">
                  样本
                </th>
                <th :class="['px-3 py-2 font-500']">
                  应判医学
                </th>
                <th :class="['px-3 py-2 font-500']">
                  规则命中
                </th>
                <th :class="['px-3 py-2 font-500']">
                  规则误判
                </th>
                <th :class="['px-3 py-2 font-500']">
                  模型命中
                </th>
                <th :class="['px-3 py-2 font-500']">
                  模型误判
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="group in report.rules.groups"
                :key="group.group"
                :class="['border-t border-neutral-200 dark:border-neutral-800']"
              >
                <td :class="['px-3 py-2']">
                  {{ intentSampleGroupLabels[group.group] }}
                </td>
                <td :class="['px-3 py-2']">
                  {{ group.total }}
                </td>
                <td :class="['px-3 py-2']">
                  {{ group.expectedMedical }}
                </td>
                <td :class="['px-3 py-2']">
                  {{ group.medicalHits }}
                </td>
                <td :class="['px-3 py-2']">
                  {{ group.falsePositives }}
                </td>
                <td :class="['px-3 py-2']">
                  {{ modelGroup(group.group)?.medicalHits ?? '—' }}
                </td>
                <td :class="['px-3 py-2']">
                  {{ modelGroup(group.group)?.falsePositives ?? '—' }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div
          v-if="report.disagreements.length"
          :class="[
            'flex flex-col gap-1 rounded-2xl border px-4 py-3 text-sm',
            'bg-amber-50/70 border-amber-200 dark:bg-amber-950/30 dark:border-amber-900',
          ]"
        >
          <div :class="['font-600']">
            两边不一致 {{ report.disagreements.length }} 条
          </div>
          <div
            v-for="item in report.disagreements"
            :key="item.sample.id"
            :class="['text-xs text-neutral-600 dark:text-neutral-300']"
          >
            {{ item.sample.input }} · 规则 {{ item.rules.decision === 'medical' ? '医学' : '闲聊' }}
            · 模型 {{ item.model?.decision === 'medical' ? '医学' : '闲聊' }}
            · 标答 {{ item.sample.expected === 'medical' ? '医学' : '闲聊' }}
          </div>
        </div>

        <div
          v-if="report.rules.falseNegatives.length"
          :class="[
            'flex flex-col gap-1 rounded-2xl border px-4 py-3 text-sm',
            'bg-red-50/70 border-red-200 dark:bg-red-950/30 dark:border-red-900',
          ]"
        >
          <div :class="['font-600']">
            规则漏判 {{ report.rules.falseNegatives.length }} 条
          </div>
          <div
            v-for="item in report.rules.falseNegatives"
            :key="item.sample.id"
            :class="['text-xs text-neutral-600 dark:text-neutral-300']"
          >
            {{ item.sample.input }} · {{ intentSampleGroupLabels[item.sample.group] }}
          </div>
        </div>
      </template>

      <template v-if="records.length">
        <div
          :class="[
            'flex items-center justify-between',
          ]"
        >
          <h2 :class="['text-base font-600']">
            本次记录 · {{ records.length }} 条
          </h2>
          <Button
            size="sm"
            variant="secondary"
            label="清空"
            @click="records = []"
          />
        </div>

        <div
          :class="[
            'overflow-x-auto rounded-2xl border',
            'border-neutral-200 dark:border-neutral-700',
          ]"
        >
          <table :class="['w-full text-left text-sm']">
            <thead :class="['bg-neutral-50 dark:bg-neutral-900']">
              <tr>
                <th :class="['px-3 py-2 font-500']">
                  模式
                </th>
                <th :class="['px-3 py-2 font-500']">
                  输入
                </th>
                <th :class="['px-3 py-2 font-500']">
                  规则
                </th>
                <th :class="['px-3 py-2 font-500']">
                  模型
                </th>
                <th :class="['px-3 py-2 font-500']">
                  一致
                </th>
                <th :class="['px-3 py-2 font-500']">
                  耗时
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="record in records"
                :key="record.at"
                :class="['border-t border-neutral-200 dark:border-neutral-800']"
              >
                <td :class="['px-3 py-2']">
                  {{ record.mode }}
                </td>
                <td :class="['px-3 py-2']">
                  {{ record.input }}
                </td>
                <td :class="['px-3 py-2']">
                  {{ record.rules ? (record.rules.decision === 'medical' ? '医学' : '闲聊') : '—' }}
                </td>
                <td :class="['px-3 py-2']">
                  {{ record.model ? (record.model.decision === 'medical' ? '医学' : '闲聊') : '—' }}
                </td>
                <td :class="['px-3 py-2']">
                  {{ record.sameDecision === undefined ? '—' : (record.sameDecision ? '是' : '否') }}
                </td>
                <td :class="['px-3 py-2']">
                  {{ record.durationMs.toFixed(0) }} ms
                </td>
              </tr>
            </tbody>
          </table>
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
