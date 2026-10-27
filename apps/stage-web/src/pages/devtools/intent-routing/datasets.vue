<script setup lang="ts">
import type { RemoteIntentCollection, RemoteIntentSample } from '@proj-airi/stage-ui/libs/intent/api'
import type { SelectOptionItem } from '@proj-airi/ui'

import { describeIntentEvalError, intentEvalApi } from '@proj-airi/stage-ui/libs/intent/api'
import { intentSampleGroupLabels } from '@proj-airi/stage-ui/libs/intent/fixtures'
import { previewSampleImport } from '@proj-airi/stage-ui/libs/intent/import-preview'
import { BasicTextarea, Button, Select } from '@proj-airi/ui'
import { useLocalStorage } from '@vueuse/core'
import { computed, onMounted, ref } from 'vue'

/**
 * The sample set the evaluation runs read.
 *
 * The sample set lives on the server (intent-routing.md §7.4). This page is the
 * only place labels are edited, and it never freezes a version by hand: a run
 * keeps its own snapshot, so editing here cannot rewrite a report that already
 * ran.
 */

const samples = ref<RemoteIntentSample[]>([])
const collections = ref<RemoteIntentCollection[]>([])
const loading = ref(false)
const busyId = ref<string>()
const failure = ref<string>()
const notice = ref<string>()

/**
 * The collection the page is working in, shared with the bench.
 *
 * An empty value means "every sample", which keeps a fresh install usable before
 * anyone names a collection.
 */
const activeCollectionId = useLocalStorage('devtools/intent-routing/collection-id', '')
const newCollectionName = ref('')
const newCollectionPurpose = ref<'development' | 'acceptance'>('development')
const renameName = ref('')
const collectionBusy = ref(false)
const confirmingDelete = ref(false)

const purposeLabels: Record<'development' | 'acceptance', string> = {
  development: '开发集',
  acceptance: '验收集',
}

const collectionOptions = computed<SelectOptionItem<string>[]>(() => [
  { label: '全部样本', value: '' },
  ...collections.value.map(collection => ({
    label: `${collection.name}（${purposeLabels[collection.purpose]}）`,
    value: collection.id,
  })),
])

const activeCollection = computed(() => collections.value.find(collection => collection.id === activeCollectionId.value))

const input = ref('')
const previous = ref('')
const group = ref<string>('medical-explicit')
// An empty choice stores no label: the sample is collected but not yet labelled.
const expected = ref<'medical' | 'chat' | ''>('')
const source = ref('')
const saving = ref(false)

const importText = ref('')
const importing = ref(false)

const groupOptions: SelectOptionItem<string>[] = Object.entries(intentSampleGroupLabels)
  .map(([value, label]) => ({ label, value }))

const labelOptions: SelectOptionItem<'medical' | 'chat' | ''>[] = [
  { label: '未标注', value: '' },
  { label: '医学', value: 'medical' },
  { label: '闲聊', value: 'chat' },
]

const reviewedCount = computed(() => samples.value.filter(sample => sample.labelStatus === 'reviewed').length)
const groupCount = computed(() => new Set(samples.value.map(sample => sample.group)).size)

async function load() {
  loading.value = true
  failure.value = undefined
  try {
    samples.value = await intentEvalApi.listSamples(activeCollectionId.value || undefined)
  }
  catch (error) {
    failure.value = describeIntentEvalError(error)
  }
  finally {
    loading.value = false
  }
}

async function loadCollections() {
  try {
    collections.value = await intentEvalApi.listCollections()
  }
  catch (error) {
    failure.value = describeIntentEvalError(error)
  }
}

/** Switches the collection and reloads the list, so the two never disagree. */
async function selectCollection() {
  renameName.value = ''
  confirmingDelete.value = false
  await load()
}

async function createCollection() {
  failure.value = undefined
  notice.value = undefined

  const name = newCollectionName.value.trim()
  if (!name) {
    failure.value = '请填写集合名称'
    return
  }

  collectionBusy.value = true
  try {
    const created = await intentEvalApi.createCollection({ name, purpose: newCollectionPurpose.value })
    newCollectionName.value = ''
    await loadCollections()
    activeCollectionId.value = created.id
    await load()
    notice.value = `已新建集合「${created.name}」`
  }
  catch (error) {
    failure.value = describeIntentEvalError(error)
  }
  finally {
    collectionBusy.value = false
  }
}

async function renameCollection() {
  failure.value = undefined
  notice.value = undefined

  const current = activeCollection.value
  const name = renameName.value.trim()
  if (!current) {
    failure.value = '先在下方选择一个集合'
    return
  }
  if (!name) {
    failure.value = '请填写新名称'
    return
  }

  collectionBusy.value = true
  try {
    await intentEvalApi.updateCollection(current.id, { name })
    renameName.value = ''
    await loadCollections()
    notice.value = '已改名'
  }
  catch (error) {
    failure.value = describeIntentEvalError(error)
  }
  finally {
    collectionBusy.value = false
  }
}

/** Two-step delete: the first click asks, the second one removes. */
async function deleteCollection() {
  failure.value = undefined
  notice.value = undefined

  const current = activeCollection.value
  if (!current)
    return

  if (!confirmingDelete.value) {
    confirmingDelete.value = true
    return
  }

  collectionBusy.value = true
  try {
    await intentEvalApi.deleteCollection(current.id)
    confirmingDelete.value = false
    // The samples stay: a sample keeps its id, and the soft-deleted collection
    // only stops resolving, so an old run can still name what it read.
    activeCollectionId.value = ''
    await loadCollections()
    await load()
    notice.value = '已删除集合（样本保留，可按「全部样本」查看）'
  }
  catch (error) {
    failure.value = describeIntentEvalError(error)
  }
  finally {
    collectionBusy.value = false
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
      context: previous.value.trim() ? [{ role: 'user' as const, content: previous.value.trim() }] : undefined,
      group: group.value as RemoteIntentSample['group'],
      ...(expected.value ? { expected: expected.value } : {}),
      source: source.value.trim() || undefined,
      ...(activeCollectionId.value ? { collectionId: activeCollectionId.value } : {}),
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

/** What the pasted batch would do, filled by the preview button. */
const preview = ref<ReturnType<typeof previewSampleImport>>()
/**
 * The text and collection the preview was computed from.
 *
 * The JSON box and the collection picker stay editable after a preview. Without
 * this, "confirm" would write the rows of an older preview under a newer
 * collection.
 */
const previewSource = ref<{ text: string, collectionId: string }>()

/**
 * Reads the pasted JSON and checks it, without writing anything.
 *
 * The server would reject a bad batch anyway, but only after the request: the
 * page could then say "invalid" without naming the row.
 */
function previewImport() {
  failure.value = undefined
  notice.value = undefined
  preview.value = undefined

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

  preview.value = previewSampleImport({ rows: parsed, existing: samples.value })
  previewSource.value = { text: importText.value, collectionId: activeCollectionId.value }
}
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
    // The box or the collection may have changed since the preview.
    const source = previewSource.value
    if (!preview.value || !source || source.text !== importText.value || source.collectionId !== activeCollectionId.value) {
      preview.value = undefined
      failure.value = '输入或集合已变化，请重新预览'
      return
    }

    // Only the previewed rows are written, and only when nothing blocks them.
    if (!preview.value) {
      failure.value = '先点「预览」确认要写入的样本'
      return
    }

    if (preview.value.issues.length) {
      failure.value = `有 ${preview.value.issues.length} 行不合法，先修正再导入`
      return
    }

    const writable = preview.value.valid
    if (!writable.length) {
      failure.value = '没有可写入的行'
      return
    }

    const rows = await intentEvalApi.importSamples(writable.map(row => ({
      ...row,
      ...(activeCollectionId.value ? { collectionId: activeCollectionId.value } : {}),
    })))
    importText.value = ''
    preview.value = undefined
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

/** The sample opened in the inline editor, and the draft being edited. */
const selected = ref<RemoteIntentSample>()
const draft = ref<{ input: string, context: { role: 'user' | 'assistant', content: string }[], group: string, expected: 'medical' | 'chat' | '', labelStatus: 'unreviewed' | 'reviewed', source: string }>()
const savingDetail = ref(false)

const roleOptions: SelectOptionItem<'user' | 'assistant'>[] = [
  { label: '用户', value: 'user' },
  { label: '助手', value: 'assistant' },
]

const statusOptions: SelectOptionItem<'unreviewed' | 'reviewed'>[] = [
  { label: '未复核', value: 'unreviewed' },
  { label: '已复核', value: 'reviewed' },
]

/**
 * Opens one sample for editing.
 *
 * The earlier turns load as an ordered array: an assistant turn changes what the
 * next message means, so it is kept instead of folded into a single line.
 */
function openDetail(sample: RemoteIntentSample) {
  selected.value = sample
  draft.value = {
    input: sample.input,
    context: sample.context?.length
      ? sample.context.map(turn => ({ role: turn.role, content: turn.content }))
      : [],
    group: sample.group,
    expected: sample.expected ?? '',
    labelStatus: sample.labelStatus,
    source: sample.source ?? '',
  }
  notice.value = undefined
  failure.value = undefined
}

function addDraftTurn() {
  if (!draft.value || draft.value.context.length >= 10)
    return
  draft.value.context = [...draft.value.context, { role: 'user', content: '' }]
}

function removeDraftTurn(index: number) {
  if (!draft.value)
    return
  draft.value.context = draft.value.context.filter((_, position) => position !== index)
}

async function saveDetail() {
  if (!selected.value || !draft.value)
    return

  failure.value = undefined
  notice.value = undefined

  const turns = draft.value.context
    .map(turn => ({ role: turn.role, content: turn.content.trim() }))
    .filter(turn => turn.content.length > 0)

  savingDetail.value = true
  try {
    await intentEvalApi.updateSample(selected.value.id, {
      input: draft.value.input.trim(),
      context: turns,
      group: draft.value.group as RemoteIntentSample['group'],
      expected: draft.value.expected || undefined,
      labelStatus: draft.value.labelStatus,
      source: draft.value.source.trim() || undefined,
    })
    notice.value = '已保存。已有报告不会因此重算，需要重新跑一次批量。'
    selected.value = undefined
    draft.value = undefined
    await load()
  }
  catch (error) {
    failure.value = describeIntentEvalError(error)
  }
  finally {
    savingDetail.value = false
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

onMounted(async () => {
  await loadCollections()
  await load()
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

    <section
      :class="[
        'flex flex-col gap-3 rounded-2xl border px-4 py-3 text-sm',
        'bg-white dark:bg-neutral-900',
        'border-neutral-200 dark:border-neutral-700',
      ]"
    >
      <h2 :class="['text-base font-600']">
        样本集
        <span :class="['text-xs font-400 text-neutral-500 dark:text-neutral-400']">
          批量运行按集合取样；不选时用全部样本
        </span>
      </h2>

      <p :class="['text-xs text-neutral-500 dark:text-neutral-400']">
        「验收集」只在最终验收时使用，测试台不会列出它；这里的标注和导入不受限制。
      </p>

      <div :class="['flex flex-wrap items-end gap-3']">
        <label :class="['flex flex-col gap-1 text-xs text-neutral-500 dark:text-neutral-400']">
          当前集合
          <Select v-model="activeCollectionId" :options="collectionOptions" @update:model-value="selectCollection" />
        </label>

        <label :class="['flex flex-col gap-1 text-xs text-neutral-500 dark:text-neutral-400']">
          新集合名称
          <input v-model="newCollectionName" :class="['rounded-lg border px-2 py-1 text-xs', 'border-neutral-200 bg-white dark:border-neutral-700 dark:bg-neutral-900']" placeholder="例如：开发集 2026-10">
        </label>

        <label :class="['flex flex-col gap-1 text-xs text-neutral-500 dark:text-neutral-400']">
          用途
          <Select
            v-model="newCollectionPurpose"
            :options="[
              { label: '开发集', value: 'development' },
              { label: '验收集', value: 'acceptance' },
            ]"
          />
        </label>

        <Button size="sm" :loading="collectionBusy" label="新建集合" @click="createCollection" />
      </div>

      <div v-if="activeCollection" :class="['flex flex-wrap items-end gap-3 border-t border-neutral-200 pt-3 dark:border-neutral-700']">
        <span :class="['text-xs text-neutral-500 dark:text-neutral-400']">
          {{ activeCollection.name }} · {{ purposeLabels[activeCollection.purpose] }}
        </span>

        <label :class="['flex flex-col gap-1 text-xs text-neutral-500 dark:text-neutral-400']">
          改名
          <input v-model="renameName" :class="['rounded-lg border px-2 py-1 text-xs', 'border-neutral-200 bg-white dark:border-neutral-700 dark:bg-neutral-900']" :placeholder="activeCollection.name">
        </label>
        <Button size="sm" variant="secondary" :loading="collectionBusy" label="保存名称" @click="renameCollection" />
        <Button
          size="sm"
          variant="secondary"
          :loading="collectionBusy"
          :label="confirmingDelete ? '确认删除集合' : '删除集合'"
          @click="deleteCollection"
        />
        <Button v-if="confirmingDelete" size="sm" variant="secondary" label="取消" @click="confirmingDelete = false" />
      </div>
    </section>
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
      <section
        v-if="selected && draft"
        :class="[
          'flex flex-col gap-3 rounded-2xl border px-4 py-3 text-sm',
          'bg-white dark:bg-neutral-900',
          'border-primary-300 dark:border-primary-800',
        ]"
      >
        <h2 :class="['text-base font-600']">
          编辑样本
          <span :class="['text-xs font-400 text-neutral-500 dark:text-neutral-400']">
            {{ selected.id }} · {{ draft.context.length }} 轮上文
          </span>
        </h2>

        <BasicTextarea v-model="draft.input" :submit-on-enter="false" placeholder="当前消息" :class="['rounded-xl border px-3 py-2', 'border-neutral-200 dark:border-neutral-700']" min-h="[64px]" w-full />

        <div :class="['flex flex-col gap-2']">
          <div v-for="(turn, index) in draft.context" :key="index" :class="['flex flex-wrap items-start gap-2']">
            <Select v-model="turn.role" :options="roleOptions" />
            <BasicTextarea v-model="turn.content" :submit-on-enter="false" :class="['flex-1 rounded-xl border px-3 py-2', 'border-neutral-200 dark:border-neutral-700']" min-h="[44px]" placeholder="这一轮说了什么" />
            <Button size="sm" variant="secondary" label="删除这一轮" @click="removeDraftTurn(index)" />
          </div>
          <div>
            <Button size="sm" variant="secondary" :disabled="draft.context.length >= 10" label="加一轮上文" @click="addDraftTurn" />
          </div>
        </div>

        <div :class="['flex flex-wrap items-center gap-3']">
          <label :class="['flex items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400']">
            分组
            <Select v-model="draft.group" :options="groupOptions" />
          </label>
          <label :class="['flex items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400']">
            标答
            <Select v-model="draft.expected" :options="labelOptions" />
          </label>
          <label :class="['flex items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400']">
            复核
            <Select v-model="draft.labelStatus" :options="statusOptions" />
          </label>
          <label :class="['flex items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400']">
            来源
            <input v-model="draft.source" :class="['rounded-lg border px-2 py-1 text-xs', 'border-neutral-200 bg-white dark:border-neutral-700 dark:bg-neutral-900']" placeholder="可选">
          </label>
        </div>

        <div :class="['flex flex-wrap items-center gap-2']">
          <Button size="sm" :loading="savingDetail" label="保存" @click="saveDetail" />
          <Button size="sm" variant="secondary" label="取消" @click="selected = undefined; draft = undefined" />
        </div>
      </section>
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
      <div :class="['flex flex-wrap items-center gap-2']">
        <Button size="sm" variant="secondary" label="预览" @click="previewImport" />
        <Button size="sm" :loading="importing" label="确认写入" @click="importJson" />
      </div>

      <div v-if="preview" :class="['flex flex-col gap-2 rounded-xl border px-3 py-2 text-xs', 'border-neutral-200 dark:border-neutral-700']">
        <div>
          共 {{ preview.total }} 行 · 可写入 {{ preview.valid.length }} 行
          · 不合法 {{ preview.issues.length }} 行 · 重复 {{ preview.duplicates.length }} 行
        </div>

        <div v-if="preview.issues.length" :class="['flex flex-col gap-1 text-red-700 dark:text-red-300']">
          <div v-for="issue in preview.issues" :key="`issue-${issue.index}`">
            第 {{ issue.index + 1 }} 行：{{ issue.detail }}
          </div>
        </div>

        <div v-if="preview.duplicates.length" :class="['flex flex-col gap-1 text-amber-700 dark:text-amber-400']">
          <div>与已有样本或本批前面的行重复（不会写入）：</div>
          <div v-for="item in preview.duplicates" :key="`dup-${item.index}`">
            第 {{ item.index + 1 }} 行
          </div>
        </div>

        <div v-if="!preview.issues.length && !preview.valid.length" :class="['text-neutral-500 dark:text-neutral-400']">
          没有可写入的行。
        </div>
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
                <div v-if="sample.context?.length" :class="['text-[10px] text-neutral-500 dark:text-neutral-400']">
                  上文：{{ sample.context.length }} 轮 · {{ sample.context[0]?.content }}
                </div>
              </td>
              <td :class="['px-2 py-1']">
                {{ sample.expected === 'medical' ? '医学' : sample.expected === 'chat' ? '闲聊' : '未标注' }}
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
                  @click="openDetail(sample)"
                >
                  编辑
                </button>
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
