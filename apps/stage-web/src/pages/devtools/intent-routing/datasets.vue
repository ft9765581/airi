<script setup lang="ts">
import type { RemoteIntentSample } from '@proj-airi/stage-ui/libs/intent/api'
import type { SelectOptionItem } from '@proj-airi/ui'

import { describeIntentEvalError, intentEvalApi } from '@proj-airi/stage-ui/libs/intent/api'
import { intentSampleGroupLabels } from '@proj-airi/stage-ui/libs/intent/fixtures'
import { BasicTextarea, Button, Select } from '@proj-airi/ui'
import { computed, onMounted, ref } from 'vue'

/**
 * The sample set the evaluation runs read.
 *
 * The sample set lives on the server (intent-routing.md §9.4). This page is the
 * only place labels are edited, and it never freezes a version by hand: a run
 * keeps its own snapshot, so editing here cannot rewrite a report that already
 * ran.
 */

const samples = ref<RemoteIntentSample[]>([])
const loading = ref(false)
const busyId = ref<string>()
const failure = ref<string>()
const notice = ref<string>()

const input = ref('')
const previous = ref('')
const group = ref<string>('medical-explicit')
const expected = ref<'medical' | 'chat'>('medical')
const source = ref('')
const saving = ref(false)

const importText = ref('')
const importing = ref(false)

const groupOptions: SelectOptionItem<string>[] = Object.entries(intentSampleGroupLabels)
  .map(([value, label]) => ({ label, value }))

const labelOptions: SelectOptionItem<'medical' | 'chat'>[] = [
  { label: '医学', value: 'medical' },
  { label: '闲聊', value: 'chat' },
]

const reviewedCount = computed(() => samples.value.filter(sample => sample.labelStatus === 'reviewed').length)
const groupCount = computed(() => new Set(samples.value.map(sample => sample.group)).size)

async function load() {
  loading.value = true
  failure.value = undefined
  try {
    samples.value = await intentEvalApi.listSamples()
  }
  catch (error) {
    failure.value = describeIntentEvalError(error)
  }
  finally {
    loading.value = false
  }
}

async function create() {
  failure.value = undefined
  notice.value = undefined

  if (!input.value.trim()) {
    failure.value = '请填写当前消息'
    return
  }

  saving.value = true
  try {
    await intentEvalApi.importSamples([{
      input: input.value.trim(),
      previous: previous.value.trim() || undefined,
      group: group.value as RemoteIntentSample['group'],
      expected: expected.value,
      source: source.value.trim() || undefined,
    }])
    input.value = ''
    previous.value = ''
    source.value = ''
    notice.value = '已新增 1 条'
    await load()
  }
  catch (error) {
    failure.value = describeIntentEvalError(error)
  }
  finally {
    saving.value = false
  }
}

/**
 * Imports a batch from JSON.
 *
 * The pasted text is parsed here, but the server validates every row again: a
 * malformed row rejects the whole file, so a half import cannot look complete.
 */
async function importJson() {
  failure.value = undefined
  notice.value = undefined

  let parsed: unknown
  try {
    parsed = JSON.parse(importText.value)
  }
  catch (error) {
    failure.value = `JSON 解析失败：${describeIntentEvalError(error)}`
    return
  }

  if (!Array.isArray(parsed)) {
    failure.value = '需要一个数组，每项是一条样本'
    return
  }

  importing.value = true
  try {
    const rows = await intentEvalApi.importSamples(parsed as never)
    importText.value = ''
    notice.value = `已导入 ${rows.length} 条`
    await load()
  }
  catch (error) {
    failure.value = describeIntentEvalError(error)
  }
  finally {
    importing.value = false
  }
}

async function patch(sample: RemoteIntentSample, changes: Partial<Pick<RemoteIntentSample, 'expected' | 'labelStatus'>>) {
  failure.value = undefined
  busyId.value = sample.id
  try {
    await intentEvalApi.updateSample(sample.id, changes)
    await load()
  }
  catch (error) {
    failure.value = describeIntentEvalError(error)
  }
  finally {
    busyId.value = undefined
  }
}

async function remove(sample: RemoteIntentSample) {
  failure.value = undefined
  busyId.value = sample.id
  try {
    await intentEvalApi.deleteSample(sample.id)
    notice.value = '已删除一条（软删除，旧运行仍保留当时的快照）'
    await load()
  }
  catch (error) {
    failure.value = describeIntentEvalError(error)
  }
  finally {
    busyId.value = undefined
  }
}

onMounted(() => {
  void load()
})
</script>

<template>
  <div :class="['flex flex-col gap-4 pb-12']">
    <div :class="['flex flex-wrap items-center gap-2']">
      <RouterLink to="/devtools/intent-routing" :class="['text-sm text-primary-600 underline dark:text-primary-400']">
        ← 回测试台
      </RouterLink>
      <RouterLink to="/devtools/intent-routing/runs" :class="['text-sm text-primary-600 underline dark:text-primary-400']">
        运行历史
      </RouterLink>
      <Button size="sm" variant="secondary" :loading="loading" label="刷新" @click="load" />
      <span :class="['text-xs text-neutral-500 dark:text-neutral-400']">
        共 {{ samples.length }} 条 · 已复核 {{ reviewedCount }} 条 · {{ groupCount }} 个分组
      </span>
    </div>

    <p v-if="failure" :class="['rounded-xl border px-3 py-2 text-sm', 'border-red-200 bg-red-50/70 text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300']">
      {{ failure }}
    </p>
    <p v-if="notice" :class="['rounded-xl border px-3 py-2 text-sm', 'border-green-200 bg-green-50/70 text-green-700 dark:border-green-900 dark:bg-green-950/30 dark:text-green-300']">
      {{ notice }}
    </p>

    <section
      :class="[
        'flex flex-col gap-3 rounded-2xl border px-4 py-3 text-sm',
        'bg-white dark:bg-neutral-900',
        'border-neutral-200 dark:border-neutral-700',
      ]"
    >
      <h2 :class="['text-base font-600']">
        新增一条样本
      </h2>

      <BasicTextarea v-model="input" :submit-on-enter="false" placeholder="当前消息，例如：宝宝黄疸怎么看" :class="['rounded-xl border px-3 py-2', 'border-neutral-200 dark:border-neutral-700']" min-h="[64px]" w-full />
      <BasicTextarea v-model="previous" :submit-on-enter="false" placeholder="上文（可选）：这句依赖的上一轮用户发言" :class="['rounded-xl border px-3 py-2', 'border-neutral-200 dark:border-neutral-700']" min-h="[44px]" w-full />

      <div :class="['flex flex-wrap items-center gap-3']">
        <label :class="['flex items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400']">
          分组
          <Select v-model="group" :options="groupOptions" />
        </label>
        <label :class="['flex items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400']">
          标答
          <Select v-model="expected" :options="labelOptions" />
        </label>
        <label :class="['flex items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400']">
          来源
          <input v-model="source" :class="['rounded-lg border px-2 py-1 text-xs', 'border-neutral-200 bg-white dark:border-neutral-700 dark:bg-neutral-900']" placeholder="可选">
        </label>
        <Button size="sm" :loading="saving" label="新增" @click="create" />
      </div>
    </section>

    <section
      :class="[
        'flex flex-col gap-3 rounded-2xl border px-4 py-3 text-sm',
        'bg-white dark:bg-neutral-900',
        'border-neutral-200 dark:border-neutral-700',
      ]"
    >
      <h2 :class="['text-base font-600']">
        批量导入
        <span :class="['text-xs font-400 text-neutral-500 dark:text-neutral-400']">
          JSON 数组 · 单次最多 500 条 · 一条坏行整批拒绝
        </span>
      </h2>

      <BasicTextarea
        v-model="importText"
        :submit-on-enter="false"
        placeholder="[{&quot;input&quot;:&quot;宝宝黄疸怎么看&quot;,&quot;group&quot;:&quot;medical-explicit&quot;,&quot;expected&quot;:&quot;medical&quot;}]"
        :class="['rounded-xl border px-3 py-2 font-mono text-xs', 'border-neutral-200 dark:border-neutral-700']"
        min-h="[96px]"
        w-full
      />
      <div>
        <Button size="sm" :loading="importing" label="导入" @click="importJson" />
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
        当前样本
      </h2>

      <div :class="['overflow-x-auto']">
        <table :class="['w-full text-left text-sm']">
          <thead :class="['bg-neutral-50 dark:bg-neutral-900']">
            <tr>
              <th :class="['px-2 py-1 font-500']">
                分组
              </th>
              <th :class="['px-2 py-1 font-500']">
                输入
              </th>
              <th :class="['px-2 py-1 font-500']">
                标答
              </th>
              <th :class="['px-2 py-1 font-500']">
                复核
              </th>
              <th :class="['px-2 py-1 font-500']">
                来源
              </th>
              <th :class="['px-2 py-1 font-500']">
                操作
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="sample in samples"
              :key="sample.id"
              :class="['border-t border-neutral-200 dark:border-neutral-800']"
            >
              <td :class="['px-2 py-1 text-xs text-neutral-500 dark:text-neutral-400']">
                {{ intentSampleGroupLabels[sample.group] ?? sample.group }}
              </td>
              <td :class="['px-2 py-1']">
                <div>{{ sample.input }}</div>
                <div v-if="sample.previous" :class="['text-[10px] text-neutral-500 dark:text-neutral-400']">
                  上文：{{ sample.previous }}
                </div>
              </td>
              <td :class="['px-2 py-1']">
                {{ sample.expected === 'medical' ? '医学' : '闲聊' }}
              </td>
              <td :class="['px-2 py-1 text-xs', sample.labelStatus === 'reviewed' ? 'text-green-700 dark:text-green-400' : 'text-amber-700 dark:text-amber-400']">
                {{ sample.labelStatus === 'reviewed' ? '已复核' : '未复核' }}
              </td>
              <td :class="['px-2 py-1 text-xs text-neutral-500 dark:text-neutral-400']">
                {{ sample.source || '—' }}
              </td>
              <td :class="['flex flex-wrap gap-2 px-2 py-1 text-xs']">
                <button
                  type="button"
                  :class="['underline decoration-dotted underline-offset-2 hover:text-primary-600 dark:hover:text-primary-400']"
                  :disabled="busyId === sample.id"
                  @click="patch(sample, { expected: sample.expected === 'medical' ? 'chat' : 'medical' })"
                >
                  改标答
                </button>
                <button
                  type="button"
                  :class="['underline decoration-dotted underline-offset-2 hover:text-primary-600 dark:hover:text-primary-400']"
                  :disabled="busyId === sample.id"
                  @click="patch(sample, { labelStatus: sample.labelStatus === 'reviewed' ? 'unreviewed' : 'reviewed' })"
                >
                  {{ sample.labelStatus === 'reviewed' ? '撤销复核' : '标记已复核' }}
                </button>
                <button
                  type="button"
                  :class="['underline decoration-dotted underline-offset-2 text-red-600 hover:text-red-700 dark:text-red-400']"
                  :disabled="busyId === sample.id"
                  @click="remove(sample)"
                >
                  删除
                </button>
              </td>
            </tr>
            <tr v-if="!samples.length">
              <td :colspan="6" :class="['px-2 py-3 text-xs text-neutral-500 dark:text-neutral-400']">
                还没有样本。上面新增一条，或回测试台把内置样本导入。
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>
</template>

<route lang="yaml">
name: IntentRoutingDatasets
meta:
  layout: settings
  # A second-level page under the test bench; the sidebar keeps one entry.
  settingsEntry: false
  title: 意图评测 · 样本集
  description: 查看、新增、导入并复核意图评测使用的样本
  icon: i-solar:notebook-bold-duotone
</route>
