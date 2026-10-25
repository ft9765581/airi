<script setup lang="ts">
import type { ClassifyResult } from '@proj-airi/stage-ui/libs/intent/classify'
import type { IntentClassifierMode, IntentDecision } from '@proj-airi/stage-ui/libs/intent/contract'
import type { EvaluationCase, EvaluationReport, IntentSampleGroup } from '@proj-airi/stage-ui/libs/intent/evaluate'

import { errorMessageFrom } from '@moeru/std'
import { classifyMessage } from '@proj-airi/stage-ui/libs/intent/classify'
import { defaultClassifierSystemPrompt } from '@proj-airi/stage-ui/libs/intent/classify-model'
import { evaluateSamples } from '@proj-airi/stage-ui/libs/intent/evaluate'
import { intentSampleGroupLabels, intentSamples } from '@proj-airi/stage-ui/libs/intent/fixtures'
import { useConsciousnessStore } from '@proj-airi/stage-ui/stores/modules/consciousness'
import { useProviderConfigStore } from '@proj-airi/stage-ui/stores/providers/config'
import { BasicTextarea, Button } from '@proj-airi/ui'
import { useLocalStorage } from '@vueuse/core'
import { computed, onMounted, ref } from 'vue'

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

/**
 * The last report, kept across a reload.
 *
 * A run over 62 samples takes half a minute with the model, so losing the table
 * to a page refresh wastes the run. The timestamp is stored beside it so a
 * stale table is not read as a fresh one.
 */
const report = useLocalStorage<EvaluationReport | undefined>('devtools/intent-routing/last-report', undefined)
const reportAt = useLocalStorage<number>('devtools/intent-routing/last-report-at', 0)
const records = ref<TestRecord[]>([])

/**
 * Tells a stored report apart from anything else the key may hold.
 *
 * A value written by an older build, or by a person in the console, would
 * otherwise reach the template and crash the page during its first render,
 * because the field it reads is simply absent.
 */
function isEvaluationReport(value: unknown): value is EvaluationReport {
  if (!value || typeof value !== 'object')
    return false

  const candidate = value as Partial<EvaluationReport>
  return typeof candidate.total === 'number'
    && !!candidate.rules
    && typeof candidate.rules.medicalRecall === 'number'
    && Array.isArray(candidate.rules.groups)
    && Array.isArray(candidate.unmatched)
    && !!candidate.durationMs
}

// Runs during setup, not on mount: a bad value must be gone before the first
// render, and the first render happens before any lifecycle hook.
if (!isEvaluationReport(report.value))
  report.value = undefined

/**
 * The prompt under test.
 *
 * Kept in local storage so a tuning session survives a reload. An edited copy
 * is not reflected in `classifierVersion`, so a conclusion has to be confirmed
 * against the default prompt before it is written down.
 */
const systemPrompt = useLocalStorage('devtools/intent-routing/system-prompt', defaultClassifierSystemPrompt)
const promptIsCustom = computed(() => systemPrompt.value !== defaultClassifierSystemPrompt)

function resolveModelOptions() {
  const providerId = consciousnessStore.activeProvider
  const config = providerId ? providerConfigStore.getProviderConfig(providerId) : undefined
  const baseURL = typeof config?.baseUrl === 'string' ? config.baseUrl : ''

  return {
    baseURL,
    apiKey: typeof config?.apiKey === 'string' ? config.apiKey : undefined,
    model: consciousnessStore.activeModel,
    systemPrompt: systemPrompt.value,
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

/** Names the side that matched the label, so a row needs no reading to judge. */
function verdictOf(item: EvaluationCase) {
  const rulesRight = item.rules.decision === item.sample.expected
  const modelRight = item.model ? item.model.decision === item.sample.expected : false

  if (rulesRight && modelRight)
    return '都对'
  if (rulesRight)
    return '规则对'
  if (modelRight)
    return '模型对'

  return '都不对'
}

/** Colour for one verdict, so a wrong row is visible without reading the text. */
function verdictClass(item: EvaluationCase) {
  const verdict = verdictOf(item)

  if (verdict === '都不对')
    return 'text-red-600 dark:text-red-400'
  if (verdict === '都对')
    return 'text-green-700 dark:text-green-400'

  return 'text-amber-700 dark:text-amber-400'
}

function labelText(decision: 'medical' | 'chat') {
  return decision === 'medical' ? '医学' : '闲聊'
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
    reportAt.value = Date.now()
  }
  catch (error) {
    failure.value = errorMessageFrom(error) ?? '评测失败'
  }
  finally {
    evaluating.value = false
  }
}

/**
 * Fills the table on a first visit.
 *
 * Only the rule classifier runs here: it costs nothing, so the page opens on
 * real numbers instead of an empty panel. A stored report is left alone, so a
 * model run is not replaced by a rule run just because the page reloaded.
 */
onMounted(() => {
  if (isDevelopment && !report.value)
    void runEvaluation()
})

function overviewMetrics() {
  const current = report.value
  // A second guard: the setup check already rejects a malformed stored value,
  // but a render must never depend on that check having run first.
  if (!current?.rules)
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

      <details
        :class="[
          'rounded-2xl border px-4 py-3 text-sm',
          'bg-white dark:bg-neutral-900',
          'border-neutral-200 dark:border-neutral-700',
        ]"
      >
        <summary :class="['cursor-pointer font-500']">
          模型提示词
          <span :class="['text-xs text-neutral-500 dark:text-neutral-400']">
            {{ promptIsCustom ? '已修改，不写入分类器版本号' : '默认' }}
          </span>
        </summary>

        <div
          :class="[
            'mt-3 flex flex-col gap-2',
          ]"
        >
          <BasicTextarea
            v-model="systemPrompt"
            :submit-on-enter="false"
            placeholder="分类器提示词"
            :class="[
              'rounded-xl border px-3 py-2 font-mono text-xs',
              'bg-white dark:bg-neutral-900',
              'border-neutral-200 dark:border-neutral-700',
            ]"
            min-h="[220px]"
            w-full
          />
          <div
            :class="[
              'flex flex-wrap items-center gap-2',
            ]"
          >
            <Button
              size="sm"
              variant="secondary"
              label="恢复默认"
              @click="systemPrompt = defaultClassifierSystemPrompt"
            />
            <span :class="['text-xs text-neutral-500 dark:text-neutral-400']">
              只有 model / compare 模式用到这段提示词。改完直接测，刷新不会丢。
            </span>
          </div>
        </div>
      </details>

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
          <span :class="['text-xs font-400 text-neutral-500 dark:text-neutral-400']">
            · 上次运行 {{ reportAt ? new Date(reportAt).toLocaleTimeString() : '未知' }}
          </span>
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

        <template v-if="report.disagreements.length">
          <h2 :class="['text-base font-600']">
            两边不一致 · {{ report.disagreements.length }} 条
          </h2>

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
                    输入
                  </th>
                  <th :class="['px-3 py-2 font-500']">
                    标答
                  </th>
                  <th :class="['px-3 py-2 font-500']">
                    规则
                  </th>
                  <th :class="['px-3 py-2 font-500']">
                    模型
                  </th>
                  <th :class="['px-3 py-2 font-500']">
                    谁对
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="item in report.disagreements"
                  :key="item.sample.id"
                  :class="['border-t border-neutral-200 dark:border-neutral-800']"
                >
                  <td :class="['px-3 py-2']">
                    {{ item.sample.input }}
                  </td>
                  <td :class="['px-3 py-2']">
                    {{ labelText(item.sample.expected) }}
                  </td>
                  <td :class="['px-3 py-2']">
                    {{ labelText(item.rules.decision) }}
                  </td>
                  <td :class="['px-3 py-2']">
                    {{ item.model ? labelText(item.model.decision) : '—' }}
                  </td>
                  <td :class="['px-3 py-2 font-500', verdictClass(item)]">
                    {{ verdictOf(item) }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </template>

        <template v-if="report.rules.falseNegatives.length">
          <h2 :class="['text-base font-600']">
            规则漏判 · {{ report.rules.falseNegatives.length }} 条
          </h2>

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
                    输入
                  </th>
                  <th :class="['px-3 py-2 font-500']">
                    分组
                  </th>
                  <th :class="['px-3 py-2 font-500']">
                    规则
                  </th>
                  <th :class="['px-3 py-2 font-500']">
                    模型
                  </th>
                  <th :class="['px-3 py-2 font-500']">
                    模型补上了吗
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="item in report.rules.falseNegatives"
                  :key="item.sample.id"
                  :class="['border-t border-neutral-200 dark:border-neutral-800']"
                >
                  <td :class="['px-3 py-2']">
                    {{ item.sample.input }}
                  </td>
                  <td :class="['px-3 py-2']">
                    {{ intentSampleGroupLabels[item.sample.group] }}
                  </td>
                  <td :class="['px-3 py-2']">
                    {{ labelText(item.rules.decision) }}
                  </td>
                  <td :class="['px-3 py-2']">
                    {{ item.model ? labelText(item.model.decision) : '—' }}
                  </td>
                  <td
                    :class="[
                      'px-3 py-2 font-500',
                      item.model?.decision === 'medical'
                        ? 'text-green-700 dark:text-green-400'
                        : 'text-red-600 dark:text-red-400',
                    ]"
                  >
                    {{ item.model ? (item.model.decision === 'medical' ? '补上了' : '没补上') : '—' }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </template>
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
  # Puts the page on the settings index. `/settings` builds its list from routes
  # that carry this flag, sorted by `order`, so a large order keeps a development
  # tool after the real settings sections.
  settingsEntry: true
  order: 99
  title: 意图识别评测
  description: 对比规则和 DeepSeek 对同一批句子的医学判定
  icon: i-solar:chart-2-bold-duotone
</route>
