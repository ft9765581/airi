<script setup lang="ts">
import type { RemoteIntentRun, RemoteRunCase } from '@proj-airi/stage-ui/libs/intent/api'

import { describeIntentEvalError, intentEvalApi } from '@proj-airi/stage-ui/libs/intent/api'
import { Button, SelectTab } from '@proj-airi/ui'
import { computed, onMounted, ref } from 'vue'

/**
 * The runs that already happened.
 *
 * A run is an immutable record: it keeps its own sample snapshot, so this page
 * shows what that run saw even after the sample set changed (intent-routing.md
 * §9.4). It is read-only on purpose — a verdict from last week must not be
 * edited into agreement with today's labels.
 */

const runs = ref<RemoteIntentRun[]>([])
const loading = ref(false)
const failure = ref<string>()
const selectedId = ref<string>()
const limit = ref('20')

const limitOptions = [
  { label: '最近 20 次', value: '20' },
  { label: '最近 50 次', value: '50' },
  { label: '最近 100 次', value: '100' },
]

type CaseFilter = 'all' | 'disagree' | 'failure' | 'uncertain'

const caseFilter = ref<CaseFilter>('all')

const caseFilters: { label: string, value: CaseFilter }[] = [
  { label: '全部', value: 'all' },
  { label: '不一致', value: 'disagree' },
  { label: '失败', value: 'failure' },
  { label: '不确定', value: 'uncertain' },
]

const selected = computed(() => runs.value.find(run => run.id === selectedId.value))

/** A verdict cell: the label, or why the run stored none. */
function verdictText(verdict: string | undefined): string {
  if (!verdict)
    return '未运行'
  if (verdict === 'failed')
    return '失败'
  if (verdict === 'uncertain')
    return '不确定'

  return verdict === 'medical' ? '医学' : '闲聊'
}

function caseIsFailure(item: RemoteRunCase): boolean {
  return item.rules === 'failed' || item.model === 'failed'
}

const filteredCases = computed(() => {
  const cases = selected.value?.cases ?? []

  return cases.filter((item) => {
    switch (caseFilter.value) {
      case 'disagree':
        return item.disagreement === true
      case 'failure':
        return caseIsFailure(item)
      case 'uncertain':
        return false
      default:
        return true
    }
  })
})

const metricRows = computed(() => {
  const run = selected.value
  if (!run?.metrics)
    return []

  return (['rules', 'model'] as const).map((key) => {
    const metric = run.metrics?.[key]
    const label = key === 'rules' ? '规则' : '生成式'

    return {
      label,
      recall: metric?.recall === undefined ? '未运行' : `${(metric.recall * 100).toFixed(1)}%`,
      falsePositive: metric?.falsePositive === undefined ? '未运行' : `${(metric.falsePositive * 100).toFixed(1)}%`,
      failure: metric?.failure === undefined ? '未运行' : `${(metric.failure * 100).toFixed(1)}%`,
      uncertain: metric?.uncertain === undefined ? '—' : `${(metric.uncertain * 100).toFixed(1)}%`,
      denominators: metric ? `医疗 ${metric.medicalTotal ?? '—'} / 闲聊 ${metric.chatTotal ?? '—'}` : '—',
    }
  })
})

async function load() {
  loading.value = true
  failure.value = undefined
  try {
    runs.value = await intentEvalApi.listRuns(Number(limit.value))
    // Keep a selection that still exists, otherwise fall back to the newest run.
    if (!runs.value.some(run => run.id === selectedId.value))
      selectedId.value = runs.value[0]?.id
  }
  catch (error) {
    failure.value = describeIntentEvalError(error)
  }
  finally {
    loading.value = false
  }
}

onMounted(() => {
  void load()
})
</script>

<template>
  <div :class="['flex flex-col gap-4 pb-12']">
    <div :class="['flex flex-wrap items-center gap-3 text-sm']">
      <RouterLink to="/devtools/intent-routing" :class="['text-primary-600 underline dark:text-primary-400']">
        ← 回测试台
      </RouterLink>
      <RouterLink to="/devtools/intent-routing/datasets" :class="['text-primary-600 underline dark:text-primary-400']">
        样本集
      </RouterLink>
      <Button size="sm" variant="secondary" :loading="loading" label="刷新" @click="load" />
      <span :class="['text-xs text-neutral-500 dark:text-neutral-400']">
        {{ runs.length }} 次运行 · 只读
      </span>
    </div>

    <p v-if="failure" :class="['rounded-xl border px-3 py-2 text-sm', 'border-red-200 bg-red-50/70 text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300']">
      {{ failure }}
    </p>

    <div :class="['flex flex-wrap items-center gap-2']">
      <SelectTab v-model="limit" :options="limitOptions" size="sm" tab-space="compact" />
    </div>

    <section
      :class="[
        'flex flex-col gap-2 rounded-2xl border px-4 py-3 text-sm',
        'bg-white dark:bg-neutral-900',
        'border-neutral-200 dark:border-neutral-700',
      ]"
    >
      <h2 :class="['text-base font-600']">
        运行历史
      </h2>

      <div :class="['overflow-x-auto']">
        <table :class="['w-full text-left text-sm']">
          <thead :class="['bg-neutral-50 dark:bg-neutral-900']">
            <tr>
              <th :class="['px-2 py-1 font-500']">
                状态
              </th>
              <th :class="['px-2 py-1 font-500']">
                模式
              </th>
              <th :class="['px-2 py-1 font-500']">
                条数
              </th>
              <th :class="['px-2 py-1 font-500']">
                模型
              </th>
              <th :class="['px-2 py-1 font-500']">
                开始
              </th>
              <th :class="['px-2 py-1 font-500']">
                结束
              </th>
              <th :class="['px-2 py-1 font-500']">
                查看
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="item in runs"
              :key="item.id"
              :class="[
                'border-t border-neutral-200 dark:border-neutral-800',
                item.id === selectedId ? 'bg-primary-50/60 dark:bg-primary-950/40' : '',
              ]"
            >
              <td :class="['px-2 py-1']">
                {{ item.status }}
              </td>
              <td :class="['px-2 py-1']">
                {{ item.mode }} · v{{ item.sampleSetVersion }}
              </td>
              <td :class="['px-2 py-1']">
                {{ item.completed }} / {{ item.total }}
              </td>
              <td :class="['px-2 py-1 text-xs text-neutral-500 dark:text-neutral-400']">
                {{ item.modelId || '—' }}
              </td>
              <td :class="['px-2 py-1 text-xs']">
                {{ new Date(item.startedAt).toLocaleString() }}
              </td>
              <td :class="['px-2 py-1 text-xs']">
                {{ item.finishedAt ? new Date(item.finishedAt).toLocaleTimeString() : '未完成' }}
              </td>
              <td :class="['px-2 py-1']">
                <button
                  type="button"
                  :class="['text-xs underline decoration-dotted underline-offset-2 hover:text-primary-600 dark:hover:text-primary-400']"
                  @click="selectedId = item.id"
                >
                  {{ item.id === selectedId ? '已选' : '打开' }}
                </button>
              </td>
            </tr>
            <tr v-if="!runs.length">
              <td :colspan="7" :class="['px-2 py-3 text-xs text-neutral-500 dark:text-neutral-400']">
                还没有运行记录。到测试台跑一次测试集会写入。
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <template v-if="selected">
      <section
        :class="[
          'flex flex-col gap-2 rounded-2xl border px-4 py-3 text-sm',
          'bg-white dark:bg-neutral-900',
          'border-neutral-200 dark:border-neutral-700',
        ]"
      >
        <h2 :class="['text-base font-600']">
          这次运行读的是什么
          <span :class="['text-xs font-400 text-neutral-500 dark:text-neutral-400']">
            报告是当时那一份，不受当前样本改动影响
          </span>
        </h2>

        <dl :class="['grid grid-cols-1 gap-x-3 gap-y-1 sm:grid-cols-[10rem_1fr]']">
          <dt :class="['text-neutral-500 dark:text-neutral-400']">
            状态
          </dt>
          <dd>{{ selected.status }} · {{ selected.completed }} / {{ selected.total }} 条</dd>

          <dt :class="['text-neutral-500 dark:text-neutral-400']">
            配置指纹
          </dt>
          <dd :class="['break-all font-mono text-xs']">
            {{ selected.configKey }}
          </dd>

          <dt :class="['text-neutral-500 dark:text-neutral-400']">
            分类提示词
          </dt>
          <dd :class="['font-mono text-xs']">
            {{ selected.classifierPromptDigest || '未记录' }}
          </dd>

          <dt :class="['text-neutral-500 dark:text-neutral-400']">
            起止
          </dt>
          <dd>{{ new Date(selected.startedAt).toLocaleString() }} → {{ selected.finishedAt ? new Date(selected.finishedAt).toLocaleTimeString() : '未完成' }}</dd>

          <template v-if="selected.failureReason">
            <dt :class="['text-neutral-500 dark:text-neutral-400']">
              提前结束原因
            </dt>
            <dd>{{ selected.failureReason }}</dd>
          </template>
        </dl>
      </section>

      <section
        :class="[
          'flex flex-col gap-2 rounded-2xl border px-4 py-3 text-sm',
          'bg-white dark:bg-neutral-900',
          'border-neutral-200 dark:border-neutral-700',
        ]"
      >
        <h2 :class="['text-base font-600']">
          三方指标
        </h2>

        <div :class="['overflow-x-auto']">
          <table :class="['w-full text-left text-sm']">
            <thead :class="['bg-neutral-50 dark:bg-neutral-900']">
              <tr>
                <th :class="['px-2 py-1 font-500']">
                  方法
                </th>
                <th :class="['px-2 py-1 font-500']">
                  医疗召回
                </th>
                <th :class="['px-2 py-1 font-500']">
                  闲聊误判
                </th>
                <th :class="['px-2 py-1 font-500']">
                  失败率
                </th>
                <th :class="['px-2 py-1 font-500']">
                  不确定
                </th>
                <th :class="['px-2 py-1 font-500']">
                  分母
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="row in metricRows"
                :key="row.label"
                :class="['border-t border-neutral-200 dark:border-neutral-800']"
              >
                <td :class="['px-2 py-1 font-500']">
                  {{ row.label }}
                </td>
                <td :class="['px-2 py-1']">
                  {{ row.recall }}
                </td>
                <td :class="['px-2 py-1']">
                  {{ row.falsePositive }}
                </td>
                <td :class="['px-2 py-1']">
                  {{ row.failure }}
                </td>
                <td :class="['px-2 py-1']">
                  {{ row.uncertain }}
                </td>
                <td :class="['px-2 py-1 text-xs text-neutral-500 dark:text-neutral-400']">
                  {{ row.denominators }}
                </td>
              </tr>
              <tr v-if="!metricRows.length">
                <td :colspan="5" :class="['px-2 py-3 text-xs text-neutral-500 dark:text-neutral-400']">
                  这次运行没有存指标（只存了逐条结果或仍在进行）。
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section
        :class="[
          'flex flex-col gap-2 rounded-2xl border px-4 py-3 text-sm',
          'bg-white dark:bg-neutral-900',
          'border-neutral-200 dark:border-neutral-700',
        ]"
      >
        <h2 :class="['text-base font-600']">
          逐条结果
          <span :class="['text-xs font-400 text-neutral-500 dark:text-neutral-400']">
            {{ filteredCases.length }} / {{ selected.cases?.length ?? 0 }} 条
          </span>
        </h2>

        <div :class="['flex flex-wrap items-center gap-2']">
          <Button
            v-for="item in caseFilters"
            :key="item.value"
            size="sm"
            :variant="caseFilter === item.value ? 'primary' : 'secondary'"
            :label="item.label"
            @click="caseFilter = item.value"
          />
        </div>

        <div :class="['overflow-x-auto']">
          <table :class="['w-full text-left text-sm']">
            <thead :class="['bg-neutral-50 dark:bg-neutral-900']">
              <tr>
                <th :class="['px-2 py-1 font-500']">
                  输入
                </th>
                <th :class="['px-2 py-1 font-500']">
                  标答
                </th>
                <th :class="['px-2 py-1 font-500']">
                  规则
                </th>
                <th :class="['px-2 py-1 font-500']">
                  生成式
                </th>
                <th :class="['px-2 py-1 font-500']">
                  分歧
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="item in filteredCases"
                :key="item.sampleId"
                :class="['border-t border-neutral-200 dark:border-neutral-800']"
              >
                <td :class="['px-2 py-1']">
                  <div>{{ item.input }}</div>
                  <div v-if="item.context?.length" :class="['text-[10px] text-neutral-500 dark:text-neutral-400']">
                    上文：{{ item.context?.length }} 轮 · {{ item.context?.[0]?.content }}
                  </div>
                </td>
                <td :class="['px-2 py-1']">
                  {{ item.expected === 'medical' ? '医学' : item.expected === 'chat' ? '闲聊' : '未标注' }}
                </td>
                <td :class="['px-2 py-1']">
                  {{ verdictText(item.rules) }}
                </td>
                <td :class="['px-2 py-1']">
                  {{ verdictText(item.model) }}
                </td>
                <td :class="['px-2 py-1 text-xs', item.disagreement ? 'text-amber-700 dark:text-amber-400' : 'text-neutral-500 dark:text-neutral-400']">
                  {{ item.disagreement ? '不一致' : '一致' }}
                </td>
              </tr>
              <tr v-if="!filteredCases.length">
                <td :colspan="5" :class="['px-2 py-3 text-xs text-neutral-500 dark:text-neutral-400']">
                  {{ selected.cases?.length ? '这个筛选下没有样本' : '这次运行没有存逐条结果' }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </template>
  </div>
</template>

<route lang="yaml">
name: IntentRoutingRuns
meta:
  layout: settings
  # A second-level page under the test bench; the sidebar keeps one entry.
  settingsEntry: false
  title: 意图评测 · 运行历史
  description: 查看历史评测运行的配置、指标与逐条结果
  icon: i-solar:history-bold-duotone
</route>
