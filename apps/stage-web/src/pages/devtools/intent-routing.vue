<script setup lang="ts">
import type { RemoteIntentCollection, RemoteIntentRun, RemoteIntentSample, RemoteRunCase, RemoteRunMetrics } from '@proj-airi/stage-ui/libs/intent/api'
import type { ClassifyResult } from '@proj-airi/stage-ui/libs/intent/classify'
import type { ClassifyHistoryTurn, IntentModelOptions } from '@proj-airi/stage-ui/libs/intent/classify-model'
import type { IntentClassifierMode, IntentDecision } from '@proj-airi/stage-ui/libs/intent/contract'
import type { EvaluationCase, EvaluationReport, IntentSample, IntentSampleGroup } from '@proj-airi/stage-ui/libs/intent/evaluate'
import type { MedicalPreviewResult } from '@proj-airi/stage-ui/libs/intent/preview'
import type { ReportMethod } from '@proj-airi/stage-ui/libs/intent/report'
import type { MedicalAgentProblem } from '@proj-airi/stage-ui/libs/intent/route'
import type { SelectOptionItem, SelectTabOption } from '@proj-airi/ui'

import { errorMessageFrom } from '@moeru/std'
import { describeIntentEvalError, intentEvalApi } from '@proj-airi/stage-ui/libs/intent/api'
import { classifyMessage } from '@proj-airi/stage-ui/libs/intent/classify'
import { composeClassifierUserText, defaultClassifierSystemPrompt } from '@proj-airi/stage-ui/libs/intent/classify-model'
import { classifyRules } from '@proj-airi/stage-ui/libs/intent/classify-rules'
import { collectionBlockedReason, collectionsFor } from '@proj-airi/stage-ui/libs/intent/collection-policy'
import { evaluateSamples } from '@proj-airi/stage-ui/libs/intent/evaluate'
import { intentSampleGroupLabels, intentSamples, intentSampleSetVersion } from '@proj-airi/stage-ui/libs/intent/fixtures'
import { allowsMedicalGeneration, parseMedicalGenerationMode } from '@proj-airi/stage-ui/libs/intent/medical-generation'
import { composeMedicalSystemPrompt, summarizePrompt } from '@proj-airi/stage-ui/libs/intent/medical-prompt'
import { previewMedicalTurn } from '@proj-airi/stage-ui/libs/intent/preview'
import { buildEvaluationMarkdown } from '@proj-airi/stage-ui/libs/intent/report'
import { medicalAgentProblem } from '@proj-airi/stage-ui/libs/intent/route'
import { useAiriCardStore } from '@proj-airi/stage-ui/stores/modules/airi-card'
import { useConsciousnessStore } from '@proj-airi/stage-ui/stores/modules/consciousness'
import { useProviderStore } from '@proj-airi/stage-ui/stores/providers/provider'
import { BasicTextarea, Button, Select, SelectTab } from '@proj-airi/ui'
import { useLocalStorage } from '@vueuse/core'
import { computed, onMounted, ref, watch } from 'vue'

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

/** The modes the page can run, in one row. */
type PageMode = IntentClassifierMode

/**
 * The test-bench tabs (intent-routing.md §9.2).
 *
 * One input above them, one method per tab, and a tab for the comparison. The
 * tab is the only method control: the old mode buttons and this list would
 * otherwise be two sources of truth for the same choice.
 */
type BenchTab = 'rules' | 'model' | 'three-way' | 'full'

const benchTabs: SelectTabOption<BenchTab>[] = [
  { label: '规则', value: 'rules' },
  { label: '生成式模型', value: 'model' },
  { label: '三方对照', value: 'three-way' },
  { label: '完整试跑', value: 'full' },
]

const mode = ref<PageMode>('rules')

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
const providerStore = useProviderStore()

const tab = ref<BenchTab>('rules')

/**
 * Keeps `mode` in step with the tab.
 *
 * The batch run, the configuration summary and the report key all read `mode`;
 * the tab is what a person clicks. Synchronising one direction only keeps the
 * tab as the single control, so a run cannot be labelled with a method the tab
 * does not show.
 */
watch(tab, (value) => {
  if (value === 'three-way')
    mode.value = 'compare'
  else if (value !== 'full')
    mode.value = value
})
const message = ref('宝宝黄疸怎么看')
const contextText = ref('')
const running = ref(false)
const evaluating = ref(false)
const failure = ref<string>()
const result = ref<ClassifyResult>()

/** The input the single-message result belongs to, so a stale column is visible. */
const resultInput = ref('')

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
 * The sample set and run history the server owns.
 *
 * The built-in fixtures stay as the fallback: a tester without a signed-in
 * session keeps the 92 samples they can run offline, and the page says which
 * source it is reading (intent-routing.md §9.4: the browser holds no authority
 * for either).
 */
const serverSamples = ref<RemoteIntentSample[]>([])
/** True once the server answered; an empty collection still counts as an answer. */
const serverSamplesLoaded = ref(false)
const serverSamplesError = ref<string>()
const serverSamplesLoading = ref(false)
const importingSamples = ref(false)
const runs = ref<RemoteIntentRun[]>([])
const runsError = ref<string>()
const runsLoading = ref(false)
const runPersistError = ref<string>()

/** Collections as the API returns them; the bench only offers development ones. */
const collections = ref<RemoteIntentCollection[]>([])

/** The collection the pages share; empty means every stored sample. */
const activeCollectionId = useLocalStorage('devtools/intent-routing/collection-id', '')

/** The collection the bench is reading, when it knows one. */
const activeCollection = computed(() => collections.value.find(collection => collection.id === activeCollectionId.value))

/**
 * Why the samples on screen are not runnable right now.
 *
 * A load in flight still holds the previous collection's rows, and a failed
 * load with a collection selected has nothing at all. Running either would
 * score samples the page is not showing.
 */
const samplesBlocked = computed(() => {
  if (serverSamplesLoading.value)
    return '正在加载集合样本'
  if (activeCollectionId.value && !serverSamplesLoaded.value)
    return serverSamplesError.value ?? '集合样本加载失败，先刷新'

  return undefined
})

/** Why this selection cannot run here, e.g. an acceptance set left in storage. */
const collectionBlocked = computed(() => collectionBlockedReason('bench', activeCollection.value))

/**
 * The samples a run can score.
 *
 * An unlabelled sample has nothing to be right or wrong about, so it is skipped
 * instead of being counted as a miss. The count travels with the table so the
 * denominators are not silently smaller than the stored set. An acceptance
 * collection scores nothing here: the bench may not tune against it.
 */
const evaluationSamples = computed<IntentSample[]>(() => serverSamplesLoaded.value && !collectionBlocked.value && !samplesBlocked.value
  ? serverSamples.value.flatMap(sample => sample.expected
      ? [{
          id: sample.id,
          input: sample.input,
          context: sample.context?.length ? sample.context.map(turn => ({ role: turn.role, content: turn.content })) : undefined,
          expected: sample.expected,
          group: sample.group,
        }]
      : [])
  : collectionBlocked.value ? [] : intentSamples)

/** The collections the bench offers: development only, by policy. */
const benchCollectionOptions = computed<SelectOptionItem<string>[]>(() => [
  { label: '全部样本', value: '' },
  ...collectionsFor('bench', collections.value).map(collection => ({
    label: collection.name,
    value: collection.id,
  })),
])

/** Stored samples left out of a run because nobody labelled them yet. */
/** How many model requests a batch would send; rules ask none. */
const plannedModelCalls = computed(() => mode.value === 'rules' ? 0 : evaluationSamples.value.length)

const unlabelledSampleCount = computed(() => serverSamples.value.length
  ? serverSamples.value.length - evaluationSamples.value.length
  : 0)

const evaluationSetVersion = computed(() => serverSamples.value.length
  ? Math.max(...serverSamples.value.map(sample => sample.sampleSetVersion))
  : intentSampleSetVersion)

const sampleSourceLabel = computed(() => serverSamplesLoaded.value ? '服务端样本' : '内置开发样本')

/**
 * The newest completed run the database returned.
 *
 * The page keeps the detailed table for the session, but a refresh loses it: the
 * stored run is what survives a reload, so the bench shows its numbers and links
 * to the full detail page (intent-routing.md §7.5 item 5).
 */
const latestRun = computed(() => runs.value.find(run => run.status === 'completed'))

/** Reads the collections once, so the bench can name what it is looking at. */
async function loadCollections() {
  try {
    collections.value = await intentEvalApi.listCollections()
  }
  catch {
    // The bench still works without a collection list: it falls back to "全部样本".
    collections.value = []
  }
}

/** Which load is newest. Switching collections fires several at once. */
let samplesRequestId = 0

async function loadServerSamples() {
  const requestId = ++samplesRequestId
  serverSamplesLoading.value = true
  serverSamplesError.value = undefined
  try {
    const rows = await intentEvalApi.listSamples(activeCollectionId.value || undefined)

    // An older request may answer after a newer one; its rows describe a
    // collection the page is no longer showing.
    if (requestId !== samplesRequestId)
      return

    serverSamples.value = rows
    serverSamplesLoaded.value = true
  }
  catch (error) {
    if (requestId !== samplesRequestId)
      return

    // No session is the normal case for this page; it is a note, not a failure,
    // so the fixtures stay usable instead of blocking the page. The stale rows
    // go too: showing another collection's samples would mislabel the run.
    serverSamples.value = []
    serverSamplesLoaded.value = false
    serverSamplesError.value = describeIntentEvalError(error)
  }
  finally {
    if (requestId === samplesRequestId)
      serverSamplesLoading.value = false
  }
}

async function importBuiltinSamples() {
  importingSamples.value = true
  serverSamplesError.value = undefined
  try {
    await intentEvalApi.importSamples(intentSamples.map(sample => ({
      input: sample.input,
      // The route stores `context`; a fixture carries one earlier turn.
      context: sample.previous ? [{ role: 'user' as const, content: sample.previous }] : undefined,
      group: sample.group,
      expected: sample.expected,
      labelStatus: 'unreviewed' as const,
      source: '内置开发样本',
      sampleSetVersion: intentSampleSetVersion,
    })))
    await loadServerSamples()
  }
  catch (error) {
    serverSamplesError.value = describeIntentEvalError(error)
  }
  finally {
    importingSamples.value = false
  }
}

async function refreshRuns() {
  runsLoading.value = true
  runsError.value = undefined
  try {
    runs.value = await intentEvalApi.listRuns(20)
  }
  catch (error) {
    runsError.value = describeIntentEvalError(error)
  }
  finally {
    runsLoading.value = false
  }
}

/** Stable empty list, so the computed below never hands out a new array. */
const noFailures: EvaluationCase[] = []

/** The samples the model could not classify, which no score counts as a hit. */
const modelFailures = computed(() => report.value?.model?.failures ?? noFailures)

/**
 * Tells a stored report apart from anything else the key may hold.
 *
 * A value written by an older build, or by a person in the console, would
 * otherwise reach the template and crash the page during its first render,
 * because the field it reads is simply absent. `sampleSetVersion` is required
 * here as well: a report from another set must not read as a comparison.
 */
function isEvaluationReport(value: unknown): value is EvaluationReport {
  if (!value || typeof value !== 'object')
    return false

  const candidate = value as Partial<EvaluationReport>
  return typeof candidate.total === 'number'
    && typeof candidate.sampleSetVersion === 'number'
    && !!candidate.rules
    && typeof candidate.rules.medicalRecall === 'number'
    && Array.isArray(candidate.rules.groups)
    && Array.isArray(candidate.unmatched)
    && !!candidate.durationMs
    // Reports written before the traceability fields do not have them, and a
    // comparison against a key that is not there would read as "still current".
    && typeof candidate.configKey === 'string'
    && typeof candidate.ranAt === 'number'
    // Reports from before the unified table have no per-sample cases, and the
    // three-column join would read them as "every sample missing".
    && Array.isArray(candidate.cases)
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

const cardStore = useAiriCardStore()

/**
 * The whole-branch trial, as opposed to the classifier comparison above.
 *
 * The comparison answers "what does the classifier say". This answers "what
 * would this turn actually do", so it goes through the same routing and prompt
 * assembly the chat path uses.
 */
const trialRunning = ref(false)
const trialFailure = ref<string>()
const trialResult = ref<MedicalPreviewResult>()

/** `agents.medical` of the active card: what a real turn would read. */
const medicalAgent = computed(() => cardStore.activeCard?.extensions?.airi?.agents?.medical)

const generationMode = parseMedicalGenerationMode(import.meta.env.VITE_MEDICAL_GENERATION)
const generationAllowed = allowsMedicalGeneration(generationMode, { isDevelopment })

/** The reader-facing name for a card that cannot run the consultation model. */
function agentProblemLabel(problem: MedicalAgentProblem) {
  if (problem === 'agent_missing')
    return '未配置'
  if (problem === 'agent_disabled')
    return '已关闭'

  return '提示词为空'
}

/**
 * What a real turn would read right now, with drafts marked.
 *
 * Three layers meet on this page: the classifier prompt held here, the card's
 * medical agent, and the deployment switch. A tester who edits one has to see
 * which layer the edit landed in, and whether the run will read it.
 */
const configSummary = computed(() => {
  const persona = medicalAgent.value?.prompt?.trim() ?? ''
  const problem = medicalAgentProblem(medicalAgent.value)

  return [
    { label: '分类模式', value: mode.value, note: '本页实验' },
    { label: '模型', value: consciousnessStore.activeModel || '未配置', note: '已生效' },
    {
      label: '分类提示词',
      value: summarizePrompt(systemPrompt.value),
      note: promptIsCustom.value ? '草稿，不写入分类器版本' : '默认',
    },
    {
      label: '已生效分类提示词',
      value: summarizePrompt(defaultClassifierSystemPrompt),
      note: '默认',
    },
    {
      label: '医疗 agent',
      value: problem ? agentProblemLabel(problem) : '已启用',
      note: '角色卡',
    },
    {
      label: '咨询提示词',
      value: persona ? summarizePrompt(composeMedicalSystemPrompt({ persona })) : '未填写',
      note: persona ? '应用约束 + 角色卡' : '—',
    },
    {
      label: '部署开关',
      value: `${generationMode}${generationAllowed ? '（可生成）' : '（只回复固定文案）'}`,
      note: '构建配置',
    },
  ]
})

/** The branch a trial run took, named the way the reader sees it. */
const trialBranch = computed(() => {
  switch (trialResult.value?.route.kind) {
    case 'urgent':
      return '急诊指引'
    case 'medical':
      return '医疗咨询'
    case 'fallback':
      return '兜底回复'
    case 'chat':
      return '普通聊天'
    default:
      return '—'
  }
})

/**
 * What the emergency rule saw.
 *
 * It runs before the model, so a reader has to see it as a separate step: an
 * inherited signal explains why a follow-up skipped the consultation branch.
 */
const trialEmergency = computed(() => {
  const codes = trialResult.value?.rules.evidenceCodes ?? []

  if (codes.includes('red_flag'))
    return '命中当前消息'
  if (codes.includes('red_flag_inherited'))
    return '承接上一轮的危险信号'

  return '未命中'
})

/** One line per classifier verdict. A degraded answer is a failure, not a label. */
function decisionLine(decision: IntentDecision | undefined) {
  if (!decision)
    return '未运行'
  if (decision.source === 'fallback')
    return `失败（${decision.evidenceCodes.join(', ') || '未知原因'}）`

  return `${decision.decision === 'medical' ? '医学' : '闲聊'} · ${decision.evidenceCodes.join(', ') || '无证据码'}`
}

/** Where the system message of one trial came from. */
function promptSourceLabel(source: MedicalPreviewResult['promptSource']) {
  if (source === 'card-agent')
    return '角色卡提示词 + 应用约束'
  if (source === 'fixed-reply')
    return '固定回复模板'

  return '未使用医疗提示词'
}

/** Which error case was copied into the trial area, so the copy is visible. */
const trialFilledFrom = ref<string>()

/**
 * Copies one error case into the trial inputs.
 *
 * Retyping an error loses the earlier turn the sample depends on: "现在还是这样"
 * is only reproducible with the line before it, so the copy keeps that turn too.
 */
function fillTrial(item: EvaluationCase) {
  message.value = item.sample.input
  contextText.value = turnsToContextText({
    id: item.sample.id,
    input: item.sample.input,
    expected: item.sample.expected,
    group: item.sample.group,
    context: item.sample.context,
    previous: item.sample.previous,
  })
  trialFilledFrom.value = item.sample.id
  trialResult.value = undefined
  trialFailure.value = undefined
}

/** Runs the labelled set with the classifier mode the page is on. */
async function runBatch() {
  await runEvaluation()
}

/**
 * The key a report must carry to be comparable with the configuration on screen.
 *
 * A rules-only run asks no model and reads the default prompt, so the key is
 * built the same way `evaluateSamples()` builds it. Otherwise a rules report
 * would always look stale.
 */
const currentConfigKey = computed(() => {
  const effectiveMode: IntentClassifierMode = mode.value
  const rulesOnly = effectiveMode === 'rules'
  const modelId = rulesOnly ? 'no-model' : (consciousnessStore.activeModel || 'no-model')
  const promptDigest = summarizePrompt(rulesOnly ? defaultClassifierSystemPrompt : systemPrompt.value)

  // The collection and the sample ids decide comparability as much as the model
  // does: two collections of the same set version are different measurements.
  const collectionKey = activeCollectionId.value || 'all'
  const samplesKey = evaluationSamples.value
    .map(sample => [
      sample.id,
      sample.expected,
      sample.input,
      (sample.context ?? []).map(turn => `${turn.role}:${turn.content}`).join('/'),
    ].join(':'))
    .sort()
    .join(',')

  return [
    effectiveMode,
    `set${intentSampleSetVersion}`,
    modelId,
    promptDigest,
    `col:${collectionKey}`,
    `sig:${samplesKey.length}:${fingerprint(samplesKey)}`,
  ].join('|')
})

/**
 * A short, stable digest of the sample signature.
 *
 * The fingerprint travels into stored runs and is shown to a reader, so it has
 * to stay short. djb2 collides rarely enough for "did my samples change".
 */
function fingerprint(value: string): string {
  let hash = 5381
  for (let index = 0; index < value.length; index += 1)
    hash = ((hash * 33) ^ value.charCodeAt(index)) >>> 0

  return hash.toString(36)
}

/** True when the stored report was produced under a different configuration. */
const reportIsStale = computed(() => !!report.value && report.value.configKey !== currentConfigKey.value)

/** True when the stored run was produced under another configuration. */
const latestRunStale = computed(() => !!latestRun.value && latestRun.value.configKey !== currentConfigKey.value)

/** The recall of the stored run, formatted so the template stays readable. */
function storedRecall(value: number | undefined): string {
  return value === undefined ? '-' : `${(value * 100).toFixed(1)}%`
}

async function runTrial() {
  trialFailure.value = undefined
  trialResult.value = undefined

  if (!message.value.trim()) {
    trialFailure.value = '请输入当前消息'
    return
  }

  trialRunning.value = true
  trialFilledFrom.value = undefined
  try {
    const options = await resolveModelOptions()
    trialResult.value = await previewMedicalTurn({
      message: message.value,
      // The same context lines the classifier row reads, so a follow-up such as
      // "现在还是这样" can inherit the emergency the previous line described.
      history: currentContext(),
      agent: medicalAgent.value,
      allowGeneration: generationAllowed,
      request: options.request,
      classifierSystemPrompt: systemPrompt.value,
    })
  }
  catch (error) {
    trialFailure.value = errorMessageFrom(error)
  }
  finally {
    trialRunning.value = false
  }
}

/**
 * Asks the chat provider for the request one classification needs.
 *
 * The provider instance owns the address, the key, the auth wrapper and the
 * reasoning mode, so this is the request the chat path sends. Reading `baseUrl`
 * out of the stored config instead loses every value that only the provider
 * definition supplies: this deployment stores a DeepSeek key without an
 * address, so that run answered `fallback:not_configured` and sent nothing while
 * still showing a full table of numbers.
 *
 * Reasoning is off because a classifier that thinks can spend its whole output
 * budget before it writes the JSON, which ends the answer at `length`.
 */
async function resolveModelOptions(): Promise<IntentModelOptions> {
  const providerId = consciousnessStore.activeProvider
  const model = consciousnessStore.activeModel

  if (!providerId || !model)
    throw new Error('未配置聊天 provider 或模型，无法调用分类模型')

  const provider = await providerStore.getChatProviderInstance(providerId, { reasoning: 'disabled' })

  return {
    request: provider.chat(model),
    systemPrompt: systemPrompt.value,
  }
}

/**
 * The earlier turns the classifier reads, one per line.
 *
 * The page has no roles to offer, so a line counts as something the user said.
 */
function currentContext(): ClassifyHistoryTurn[] {
  return contextText.value
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => line.startsWith('助手：')
      ? { role: 'assistant' as const, content: line.slice(3).trim() }
      : { role: 'user' as const, content: line })
}

function percent(value: number) {
  return `${(value * 100).toFixed(1)}%`
}

function modelGroup(group: IntentSampleGroup) {
  return report.value?.model?.groups.find(item => item.group === group)
}

/**
 * True when the model answered and that answer matches the label.
 *
 * A degraded answer carries `medical` so routing can fail safe. It carries no
 * judgement, so it cannot win a row here.
 */
function modelIsRight(item: EvaluationCase) {
  return !!item.model && item.model.source !== 'fallback' && item.model.decision === item.sample.expected
}

/** Names the side that matched the label, so a row needs no reading to judge. */
function verdictOf(item: EvaluationCase) {
  const rulesRight = item.rules.decision === item.sample.expected

  if (rulesRight && modelIsRight(item))
    return '都对'
  if (rulesRight)
    return '规则对'
  if (modelIsRight(item))
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

/** One label per row. A degraded answer gets its own name, not a label. */
function modelLabel(item: EvaluationCase) {
  if (!item.model)
    return '—'

  return item.model.source === 'fallback' ? '失败' : labelText(item.model.decision)
}

/** Names what the model did with a sample the rules missed. */
function modelRecovery(item: EvaluationCase) {
  if (!item.model)
    return '—'
  if (item.model.source === 'fallback')
    return '模型失败'

  return item.model.decision === 'medical' ? '补上了' : '没补上'
}

/** Colours the recovery cell: only a real medical answer counts as fixed. */
function modelRecoveryClass(item: EvaluationCase) {
  if (!item.model || item.model.source === 'fallback')
    return 'text-neutral-500 dark:text-neutral-400'

  return item.model.decision === 'medical'
    ? 'text-green-700 dark:text-green-400'
    : 'text-red-600 dark:text-red-400'
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
      history: currentContext(),
      model: mode.value === 'rules' ? undefined : await resolveModelOptions(),
    })
    result.value = outcome
    resultInput.value = message.value

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

async function runEvaluation(persist = true) {
  failure.value = undefined

  // An empty collection is a real answer: running the built-in set here would
  // label the numbers with samples the page is not showing.
  if (!evaluationSamples.value.length) {
    failure.value = samplesBlocked.value ?? '当前集合没有已标注样本，先添加或换个集合'
    return
  }

  // Everything the run will be recorded under, taken now: the model call can
  // take a minute, and the page stays editable while it runs.
  const meta: RunMetadata & { mode: RemoteIntentRun['mode'], total: number } = {
    mode: mode.value,
    total: evaluationSamples.value.length,
    configKey: currentConfigKey.value,
    sampleSetVersion: evaluationSetVersion.value,
    modelId: consciousnessStore.activeModel || undefined,
    promptDigest: summarizePrompt(systemPrompt.value),
  }

  evaluating.value = true
  try {
    report.value = await evaluateSamples({
      samples: evaluationSamples.value,
      sampleSetVersion: evaluationSetVersion.value,
      mode: mode.value,
      configKey: currentConfigKey.value,
      model: mode.value === 'rules' ? undefined : await resolveModelOptions(),
    })
    reportAt.value = Date.now()

    const stored = report.value
    if (persist && stored) {
      void persistRun(
        meta.mode,
        meta.total,
        runMetricsPayload(stored),
        runCasesPayload(),
        meta,
      )
    }
  }
  catch (error) {
    failure.value = errorMessageFrom(error) ?? '评测失败'
  }
  finally {
    evaluating.value = false
  }
}

/**
 * One message judged by both classifiers (intent-routing.md §9.3).
 *
 * Each column keeps its own failure instead of collapsing into one verdict: a
 * model fallback must not read as a medical judgement.
 */
interface ThreeWayRun {
  message: string
  context: ClassifyHistoryTurn[]
  rules: IntentDecision
  model?: IntentDecision
  modelFailure?: string
  /** The text the classifier really sent, so the column can show the difference. */
  modelInput: string
  durationMs: number
  /** The configuration the run used, so a later change can invalidate the result. */
  modelId: string
  promptDigest: string
}

const threeWay = ref<ThreeWayRun>()
const threeWayRunning = ref(false)
const threeWayFailure = ref<string>()

interface ModelOutcome {
  decision?: IntentDecision
  failure?: string
}

async function runThreeWay() {
  threeWayFailure.value = undefined
  threeWay.value = undefined

  if (!message.value.trim()) {
    threeWayFailure.value = '请输入一条消息'
    return
  }

  threeWayRunning.value = true
  const startedAt = performance.now()
  const context = currentContext()
  const rules = classifyRules(message.value)
  const modelInput = composeClassifierUserText({ message: message.value, history: context })

  try {
    let model: ModelOutcome
    try {
      const options = await resolveModelOptions()
      const outcome = await classifyMessage({ message: message.value, mode: 'model', history: context, model: options })

      model = outcome.mode === 'model' ? { decision: outcome.decision } : { failure: '分类模式不是 model' }
    }
    catch (error) {
      model = { failure: errorMessageFrom(error) ?? '模型分类失败' }
    }

    threeWay.value = {
      message: message.value,
      context,
      rules,
      model: model.decision,
      modelFailure: model.failure,
      modelInput,
      durationMs: performance.now() - startedAt,
      modelId: consciousnessStore.activeModel || '',
      promptDigest: summarizePrompt(systemPrompt.value),
    }
  }
  finally {
    threeWayRunning.value = false
  }
}

/**
 * True when the snapshot no longer matches the input or configuration on screen.
 *
 * §9.3: a result from an earlier input must not keep looking like a verdict on
 * the current one. The columns keep showing the old run — with its own text — so
 * a reader can compare, but the page says it is out of date.
 */
const threeWayStale = computed(() => {
  const run = threeWay.value
  if (!run)
    return false

  return run.modelInput !== composeClassifierUserText({ message: message.value, history: currentContext() })
    || run.modelId !== (consciousnessStore.activeModel || '')
    || run.promptDigest !== summarizePrompt(systemPrompt.value)
})

/** The verdict one column shows, or the reason it has none. */
function decisionLabel(decision: IntentDecision | undefined): string {
  if (!decision)
    return '未运行'
  if (decision.source === 'fallback')
    return '失败'

  return decision.decision === 'medical' ? '医学' : '闲聊'
}

/**
 * Fills the table on a first visit.
 *
 * Only the rule classifier runs here: it costs nothing, so the page opens on
 * real numbers instead of an empty panel. A stored report is left alone, so a
 * model run is not replaced by a rule run just because the page reloaded.
 */
onMounted(async () => {
  void refreshRuns()

  // The stored selection decides what the first run reads, so both loads finish
  // before the automatic run: otherwise it scores the built-in set and labels it
  // as the collection result.
  await loadCollections()
  await loadServerSamples()

  if (isDevelopment && !report.value)
    void runEvaluation(false)
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
    { label: '模型失败', value: current.model ? `${current.model.failures.length} 条` : '未运行' },
    { label: '模型失败率', value: current.model ? percent(current.model.fallbackRate) : '未运行' },
    // The share of samples where the model returned a usable verdict. A failed
    // request is not an answer, so this is the number a reader must pair with
    // recall: high recall over a third of the set is not high recall.
    { label: '模型有效回答率', value: current.model ? percent(1 - current.model.fallbackRate) : '未运行' },
    { label: '规则耗时', value: `${current.durationMs.rules.toFixed(0)} ms` },
    { label: '模型耗时', value: current.durationMs.model === undefined ? '未运行' : `${current.durationMs.model.toFixed(0)} ms` },
    { label: '两边都不对', value: `${current.unmatched.length} 条` },
  ]
}

/** Which slice of the unified batch table is shown. */
type BatchFilter = 'all' | 'disagree' | 'medical-miss' | 'chat-false' | 'uncertain' | 'failure'

const batchFilter = ref<BatchFilter>('all')

const batchFilters: { value: BatchFilter, label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'disagree', label: '三方分歧' },
  { value: 'medical-miss', label: '医疗漏判' },
  { value: 'chat-false', label: '闲聊误判' },
  { value: 'uncertain', label: '不确定' },
  { value: 'failure', label: '失败' },
]

/** One sample with the three verdicts that judged it (§9.3: 一行样本，三列判定). */
interface BatchRow {
  id: string
  input: string
  previous?: string
  /** Every earlier turn, in order; `previous` is the single-turn form. */
  context?: { role: 'user' | 'assistant', content: string }[]
  group: IntentSampleGroup
  expected: 'medical' | 'chat'
  rules?: IntentDecision
  model?: IntentDecision
}

/**
 * The classifier report and the vector votes joined on the sample id.
 *
 * Every verdict here comes from one stored run, so the table cannot show a
 * different run than the numbers above it. The threshold is applied at read
 * time, which is why moving it re-labels these rows without a request.
 */
const batchRows = computed<BatchRow[]>(() => {
  const current = report.value
  if (!current?.cases)
    return []

  return current.cases.map(({ sample, rules, model }) => {
    return {
      id: sample.id,
      input: sample.input,
      previous: sample.previous,
      context: sample.context,
      group: sample.group,
      expected: sample.expected,
      rules,
      model,
    }
  })
})

/** A verdict only counts when the method actually answered. */
function usableVerdict(decision: IntentDecision | undefined): 'medical' | 'chat' | undefined {
  if (!decision || decision.source === 'fallback')
    return undefined

  return decision.decision
}

/** The three usable verdicts of one row, with uncertain and failures dropped. */
function rowVerdicts(row: BatchRow): ('medical' | 'chat')[] {
  const verdicts: ('medical' | 'chat')[] = []
  const rules = usableVerdict(row.rules)
  const model = usableVerdict(row.model)
  if (rules)
    verdicts.push(rules)
  if (model)
    verdicts.push(model)

  return verdicts
}

/** True when the methods that answered do not agree. */
function rowDisagrees(row: BatchRow): boolean {
  return new Set(rowVerdicts(row)).size > 1
}

/**
 * Copies one batch row into the shared input, keeping its earlier turn.
 *
 * A disagreement is only actionable if it can be reproduced: the sample's
 * `previous` turn is what makes "现在还是这样" mean anything (§9.5 item 4).
 */
/**
 * Writes earlier turns back into the shared context box.
 *
 * The box is one line per turn, so an assistant turn carries a marker the parser
 * reads back. Without the marker the refill would silently turn an assistant
 * answer into something the user said.
 */
function turnsToContextText(row: BatchRow): string {
  const turns = row.context?.length
    ? row.context
    : row.previous ? [{ role: 'user' as const, content: row.previous }] : []

  return turns
    .map(turn => (turn.role === 'assistant' ? `助手：${turn.content}` : turn.content))
    .join('\n')
}
function fillFromRow(row: BatchRow) {
  message.value = row.input
  contextText.value = turnsToContextText(row)
  trialFilledFrom.value = row.id
  trialResult.value = undefined
  trialFailure.value = undefined
}

const filteredRows = computed(() => batchRows.value.filter((row) => {
  const verdicts = rowVerdicts(row)

  switch (batchFilter.value) {
    case 'disagree':
      return new Set(verdicts).size > 1
    case 'medical-miss':
      // Some method said chat on a sample labelled medical.
      return row.expected === 'medical' && verdicts.includes('chat')
    case 'chat-false':
      // Some method said medical on a sample labelled chat.
      return row.expected === 'chat' && verdicts.includes('medical')
    case 'uncertain':
      return false
    case 'failure':
      return row.rules?.source === 'fallback' || row.model?.source === 'fallback'
    default:
      return true
  }
}))

/**
 * The three methods side by side, with the denominators they divided by.
 *
 * A percentage without its denominator hides a run that answered a third of the
 * set, so the counts travel with the metric.
 */
const batchMetrics = computed(() => {
  const current = report.value
  if (!current)
    return []

  const rows = batchRows.value
  const medicalTotal = rows.filter(row => row.expected === 'medical').length
  const chatTotal = rows.filter(row => row.expected === 'chat').length
  const denominators = `医疗 ${medicalTotal} / 闲聊 ${chatTotal}`

  return [
    {
      label: '规则',
      recall: percent(current.rules.medicalRecall),
      falsePositive: percent(current.rules.chatFalsePositiveRate),
      failure: percent(current.rules.fallbackRate),
      uncertain: '—',
      denominators,
      duration: `${current.durationMs.rules.toFixed(0)} ms`,
    },
    {
      label: '生成式',
      recall: current.model ? percent(current.model.medicalRecall) : '未运行',
      falsePositive: current.model ? percent(current.model.chatFalsePositiveRate) : '未运行',
      failure: current.model ? percent(current.model.fallbackRate) : '未运行',
      uncertain: '—',
      denominators,
      duration: current.durationMs.model === undefined ? '未运行' : `${current.durationMs.model.toFixed(0)} ms`,
    },
  ]
})

// --- server-backed samples and run history -------------------------------

/** A verdict as it is stored: the label itself, or why there is none. */
function rawVerdict(decision: IntentDecision | undefined): string | undefined {
  if (!decision)
    return undefined
  if (decision.source === 'fallback')
    return 'failed'

  return decision.decision
}

/** The batch metrics in the shape the run resource stores. */
function runMetricsPayload(current: EvaluationReport): RemoteRunMetrics {
  const rows = batchRows.value
  const medicalTotal = rows.filter(row => row.expected === 'medical').length
  const chatTotal = rows.filter(row => row.expected === 'chat').length

  return {
    rules: {
      recall: current.rules.medicalRecall,
      falsePositive: current.rules.chatFalsePositiveRate,
      failure: current.rules.fallbackRate,
      medicalTotal,
      chatTotal,
    },
    model: current.model
      ? {
          recall: current.model.medicalRecall,
          falsePositive: current.model.chatFalsePositiveRate,
          failure: current.model.fallbackRate,
          medicalTotal,
          chatTotal,
        }
      : undefined,

  }
}

/** The per-sample verdicts in the shape the run resource stores. */
function runCasesPayload(): RemoteRunCase[] {
  return batchRows.value.map(row => ({
    sampleId: row.id,
    input: row.input,
    previous: row.previous,
    context: row.context,
    expected: row.expected,
    rules: rawVerdict(row.rules),
    model: rawVerdict(row.model),
    disagreement: rowDisagrees(row),
  }))
}

/**
 * Stores one finished batch run.
 *
 * Best effort: the numbers are already on screen, and losing the history must
 * not look like losing the run. A failure is reported beside the section.
 */
/** What one run was started with, captured before any request goes out. */
export interface RunMetadata {
  configKey: string
  sampleSetVersion: number
  modelId?: string
  promptDigest: string
}

/**
 * Stores one finished batch run under the metadata it started with.
 *
 * Reading the current collection or prompt here would label a run with a
 * configuration the person switched to while the model was answering.
 */
async function persistRun(mode: RemoteIntentRun['mode'], total: number, metrics: RemoteRunMetrics, cases: RemoteRunCase[], meta: RunMetadata) {
  runPersistError.value = undefined
  try {
    const run = await intentEvalApi.createRun({
      sampleSetVersion: meta.sampleSetVersion,
      mode,
      configKey: meta.configKey,
      modelId: meta.modelId,
      classifierPromptDigest: meta.promptDigest,
      total,
    })

    await intentEvalApi.updateRun(run.id, { status: 'completed', completed: total, metrics, cases })
    await refreshRuns()
  }
  catch (error) {
    runPersistError.value = describeIntentEvalError(error)
  }
}

/**
 * The report a reviewer reads.
 *
 * Built from the same rows the table shows, so the document cannot disagree
 * with the numbers on screen. Thresholds live in the report module.
 */
const reportMarkdown = computed(() => {
  const current = report.value
  if (!current)
    return ''

  const rows = batchRows.value
  const medicalTotal = rows.filter(row => row.expected === 'medical').length
  const chatTotal = rows.filter(row => row.expected === 'chat').length
  const groupReport = (current.model ?? current.rules).groups.map(group => ({
    group: group.group,
    label: intentSampleGroupLabels[group.group],
    total: group.total,
    medicalHits: group.medicalHits,
    falsePositives: group.falsePositives,
  }))

  const methods: ReportMethod[] = [
    {
      label: '规则',
      recall: current.rules.medicalRecall,
      falsePositive: current.rules.chatFalsePositiveRate,
      failure: current.rules.fallbackRate,
      medicalTotal,
      chatTotal,
      durationMs: current.durationMs.rules,
    },
    current.model
      ? {
          label: '生成式模型',
          recall: current.model.medicalRecall,
          falsePositive: current.model.chatFalsePositiveRate,
          failure: current.model.fallbackRate,
          medicalTotal,
          chatTotal,
          durationMs: current.durationMs.model,
        }
      : { label: '生成式模型', medicalTotal, chatTotal },

  ]

  return buildEvaluationMarkdown({
    generatedAt: Date.now(),
    sampleSetVersion: current.sampleSetVersion,
    sampleCount: rows.length,
    mode: current.mode,
    modelId: current.modelId,
    classifierPromptDigest: current.classifierPromptDigest,

    methods,
    groups: groupReport,
    disagreements: rows.filter(row => rowDisagrees(row)).map(row => ({
      input: row.input,
      expected: row.expected,
      verdicts: [decisionLabel(row.rules), decisionLabel(row.model)],
    })),
  })
})

/** Downloads the report; the page keeps showing the same text as a preview. */
function downloadReport() {
  if (!reportMarkdown.value)
    return

  const blob = new Blob([reportMarkdown.value], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `intent-eval-report-v${report.value?.sampleSetVersion ?? 0}-${new Date().toISOString().slice(0, 10)}.md`
  anchor.click()
  URL.revokeObjectURL(url)
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
      <!-- The sample set is its own page; this link keeps it one click away. -->
      <div :class="['flex flex-wrap items-center gap-3 text-sm']">
        <RouterLink
          to="/devtools/intent-routing/datasets"
          :class="['text-primary-600 underline dark:text-primary-400']"
        >
          <Select v-model="activeCollectionId" :options="benchCollectionOptions" @update:model-value="loadServerSamples" />

          <!-- What survives a reload: the stored run, not the session table. -->
          <div
            v-if="latestRun"
            :class="[
              'flex w-full flex-wrap items-center gap-3 rounded-xl border px-3 py-2 text-xs',
              'bg-white dark:bg-neutral-900',
              latestRunStale ? 'border-amber-300 dark:border-amber-800' : 'border-neutral-200 dark:border-neutral-700',
            ]"
          >
            <span :class="['font-500']">最近一次运行（数据库）</span>
            <span :class="['text-neutral-500 dark:text-neutral-400']">
              {{ latestRun.total }} 条 · {{ latestRun.mode }} · {{ new Date(latestRun.startedAt).toLocaleString() }}
            </span>
            <span v-if="latestRun.metrics?.rules" :class="['text-neutral-500 dark:text-neutral-400']">
              规则 {{ storedRecall(latestRun.metrics.rules.recall) }}
              <span v-if="latestRun.metrics.model"> · 生成式 {{ storedRecall(latestRun.metrics.model.recall) }}</span>
            </span>
            <span v-if="latestRunStale" :class="['text-amber-700 dark:text-amber-400']">
              配置已变化，数字不可直接比较
            </span>
            <RouterLink to="/devtools/intent-routing/runs" :class="['text-primary-600 underline dark:text-primary-400']">
              查看这次运行
            </RouterLink>
          </div>
          样本集 · {{ evaluationSamples.length }} 条（{{ sampleSourceLabel }}）<span v-if="activeCollectionId"> · 集合筛选已开启</span><span v-if="unlabelledSampleCount"> · 未标注 {{ unlabelledSampleCount }} 条已跳过</span><span v-if="collectionBlocked" :class="['text-amber-700 dark:text-amber-400']"> · {{ collectionBlocked }}</span>
        </RouterLink>
      </div>

      <!-- What a real turn would read, with drafts marked. -->
      <section
        :class="[
          'flex flex-col gap-1 rounded-2xl border px-4 py-3 text-sm',
          'bg-white dark:bg-neutral-900',
          'border-neutral-200 dark:border-neutral-700',
        ]"
      >
        <h2 :class="['text-base font-600']">
          配置摘要
        </h2>

        <dl :class="['grid grid-cols-1 gap-x-3 gap-y-1 sm:grid-cols-[12rem_1fr_auto]']">
          <template v-for="row in configSummary" :key="row.label">
            <dt :class="['text-neutral-500 dark:text-neutral-400']">
              {{ row.label }}
            </dt>
            <dd :class="['break-all font-mono text-xs']">
              {{ row.value }}
            </dd>
            <dd :class="['text-xs text-neutral-500 dark:text-neutral-400']">
              {{ row.note }}
            </dd>
          </template>
        </dl>
      </section>

      <h2 :class="['text-base font-600']">
        共用输入
      </h2>

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

      <!-- One input above the tabs. Each tab owns its controls and its results,
           so a person never has to scroll past a method they are not testing. -->
      <SelectTab v-model="tab" :options="benchTabs" size="sm" />

      <details
        v-show="tab === 'model'"
        :class="[
          'rounded-2xl border px-4 py-3 text-sm',
          'bg-white dark:bg-neutral-900',
          'border-neutral-200 dark:border-neutral-700',
        ]"
      >
        <summary :class="['cursor-pointer font-500']">
          分类提示词草稿
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
          'flex flex-wrap items-center gap-2',
        ]"
      >
        <Button
          v-if="true"
          :loading="running"
          :label="running ? '运行中…' : '只测识别'"
          icon="i-solar:play-circle-bold-duotone"
          @click="run"
        />
        <Button
          v-if="tab === 'three-way'"
          :loading="threeWayRunning"
          :label="threeWayRunning ? '对照中…' : '运行三方对照'"
          icon="i-solar:play-circle-bold-duotone"
          @click="runThreeWay"
        />
        <Button
          v-if="tab !== 'full' && tab !== 'three-way'"
          :loading="evaluating"
          :label="evaluating ? '评测中…' : `跑测试集（${evaluationSamples.length} 条 · 预计 ${plannedModelCalls} 次模型请求）`"
          icon="i-solar:chart-2-bold-duotone"
          variant="secondary"
          @click="runBatch"
        />
        <Button
          v-if="tab === 'full'"
          :loading="trialRunning"
          :label="trialRunning ? '试跑中…' : '完整试跑'"
          icon="i-solar:rocket-2-bold-duotone"
          variant="secondary"
          @click="runTrial"
        />
        <span v-if="tab === 'full'" :class="['text-xs text-neutral-500 dark:text-neutral-400']">
          完整试跑走正式的分流与提示词组装，不写会话、不触发记忆或绘图；会消耗模型调用（分类 + 生成）。
        </span>
        <span v-if="trialFilledFrom" :class="['text-xs text-neutral-500 dark:text-neutral-400']">
          已从错例 {{ trialFilledFrom }} 填入
        </span>
      </div>

      <template v-if="tab === 'rules' || tab === 'model'">
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
      </template>

      <!-- Three columns for one input. Each keeps its own failure, and each
           shows the text it really received (§9.3). -->
      <section
        v-if="tab === 'three-way'"
        :class="[
          'flex flex-col gap-3 rounded-2xl border px-4 py-3 text-sm',
          'bg-white dark:bg-neutral-900',
          'border-neutral-200 dark:border-neutral-700',
        ]"
      >
        <h2 :class="['text-base font-600']">
          三方对照
          <span :class="['text-xs font-400 text-neutral-500 dark:text-neutral-400']">
            同一份输入 · 不改变正式聊天
          </span>
        </h2>

        <div
          v-if="threeWayFailure"
          :class="[
            'rounded-xl border px-3 py-2 text-xs',
            'bg-red-50/70 border-red-200 text-red-700 dark:bg-red-950/30 dark:border-red-900 dark:text-red-300',
          ]"
        >
          {{ threeWayFailure }}
        </div>

        <p v-if="!threeWay" :class="['text-xs text-neutral-500 dark:text-neutral-400']">
          点「运行对照」用当前输入跑一次。规则与生成式各自独立失败：模型连不上不掩盖规则说了什么。
        </p>

        <template v-else>
          <div
            v-if="threeWayStale"
            :class="[
              'rounded-xl border px-3 py-2 text-xs',
              'border-red-200 bg-red-50/70 text-red-700',
              'dark:border-red-900 dark:bg-red-950/30 dark:text-red-300',
            ]"
          >
            输入或配置已经变了（消息、上文、模型、分类提示词或阈值）。下面这份结果来自旧的一次运行，不能当作当前输入的判断，重新跑一次。
          </div>

          <div
            :class="[
              'rounded-xl border px-3 py-2 text-xs',
              'border-amber-200 bg-amber-50/70 text-amber-800',
              'dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200',
            ]"
          >
            三列不是同一次实验：分类器读「上文 + 当前消息」，向量读「上文行 + 当前消息」。每列下方是它实际收到的文本。
          </div>

          <div :class="['grid grid-cols-1 gap-3 md:grid-cols-3']">
            <div
              :class="[
                'flex flex-col gap-1 rounded-xl border px-3 py-2',
                'border-neutral-200 dark:border-neutral-700',
              ]"
            >
              <span :class="['text-xs text-neutral-500 dark:text-neutral-400']">规则</span>
              <span :class="['text-sm font-600']">{{ decisionLabel(threeWay.rules) }}</span>
              <span :class="['text-xs text-neutral-500 dark:text-neutral-400']">
                codes={{ threeWay.rules.evidenceCodes.join(', ') || '无' }}
              </span>
              <span :class="['text-xs text-neutral-500 dark:text-neutral-400']">不调用网络</span>
              <pre :class="['mt-1 overflow-x-auto whitespace-pre-wrap break-words rounded bg-neutral-100/70 p-1.5 font-mono text-[10px] dark:bg-neutral-800/60']">{{ threeWay.message }}</pre>
            </div>

            <div
              :class="[
                'flex flex-col gap-1 rounded-xl border px-3 py-2',
                'border-neutral-200 dark:border-neutral-700',
              ]"
            >
              <span :class="['text-xs text-neutral-500 dark:text-neutral-400']">生成式模型</span>
              <span :class="['text-sm font-600']">{{ decisionLabel(threeWay.model) }}</span>
              <span :class="['text-xs text-neutral-500 dark:text-neutral-400']">
                {{ consciousnessStore.activeModel || '未配置模型' }}
              </span>
              <span v-if="threeWay.model?.source === 'fallback'" :class="['text-xs text-red-600 dark:text-red-400']">
                失败码 {{ threeWay.model.evidenceCodes.join(', ') }}
              </span>
              <span v-if="threeWay.modelFailure" :class="['text-xs text-red-600 dark:text-red-400']">
                {{ threeWay.modelFailure }}
              </span>
              <pre :class="['mt-1 overflow-x-auto whitespace-pre-wrap break-words rounded bg-neutral-100/70 p-1.5 font-mono text-[10px] dark:bg-neutral-800/60']">{{ threeWay.modelInput }}</pre>
            </div>
          </div>

          <p :class="['text-xs text-neutral-500 dark:text-neutral-400']">
            模型失败不算命中；规则列不依赖网络。
          </p>
        </template>
      </section>

      <template v-if="tab === 'full'">
        <div
          v-if="trialFailure"
          :class="[
            'rounded-2xl border px-4 py-3 text-sm',
            'bg-red-50/70 border-red-200 text-red-700 dark:bg-red-950/30 dark:border-red-900 dark:text-red-300',
          ]"
        >
          {{ trialFailure }}
        </div>
        <section
          v-if="trialResult"
          :class="[
            'flex flex-col gap-2 rounded-2xl border px-4 py-3 text-sm',
            'bg-white dark:bg-neutral-900',
            'border-neutral-200 dark:border-neutral-700',
          ]"
        >
          <h2 :class="['text-base font-600']">
            完整试跑结果
            <span :class="['text-xs font-400 text-neutral-500 dark:text-neutral-400']">
              不写入会话
            </span>
          </h2>

          <dl :class="['grid grid-cols-1 gap-x-3 gap-y-1 sm:grid-cols-[8rem_1fr]']">
            <dt :class="['text-neutral-500 dark:text-neutral-400']">
              本轮分支
            </dt>
            <dd :class="['font-600']">
              {{ trialBranch }}<span
                v-if="trialResult.route.reason"
                :class="['font-400 text-neutral-500 dark:text-neutral-400']"
              >（{{ trialResult.route.reason }}）</span>
            </dd>

            <dt :class="['text-neutral-500 dark:text-neutral-400']">
              规则
            </dt>
            <dd>{{ decisionLine(trialResult.rules) }}</dd>

            <!-- Urgency is a rule decision taken before the model is asked, so the
               table shows it as its own step rather than folding it into 规则. -->
            <dt :class="['text-neutral-500 dark:text-neutral-400']">
              急症检查
            </dt>
            <dd>{{ trialEmergency }}</dd>

            <dt :class="['text-neutral-500 dark:text-neutral-400']">
              模型
            </dt>
            <dd>{{ decisionLine(trialResult.model) }}</dd>

            <dt :class="['text-neutral-500 dark:text-neutral-400']">
              有效提示词来源
            </dt>
            <dd>{{ promptSourceLabel(trialResult.promptSource) }}</dd>

            <dt :class="['text-neutral-500 dark:text-neutral-400']">
              耗时
            </dt>
            <dd>{{ trialResult.durationMs.toFixed(0) }} ms</dd>
          </dl>

          <p
            v-if="trialResult.reply"
            :class="[
              'rounded-xl border px-3 py-2',
              'border-neutral-200 dark:border-neutral-700',
            ]"
          >
            固定回复：{{ trialResult.reply }}
          </p>
          <p
            v-else-if="trialResult.answer"
            :class="['whitespace-pre-wrap leading-relaxed']"
          >
            {{ trialResult.answer }}
          </p>
          <p v-else-if="trialResult.failure" :class="['text-xs text-red-600 dark:text-red-400']">
            没有拿到回答：{{ trialResult.failure }}
          </p>
          <p v-else :class="['text-xs text-neutral-500 dark:text-neutral-400']">
            这条消息不会进入医疗分支，所以没有咨询回答。
          </p>
        </section>
      </template>

      <template v-if="report">
        <h2 :class="['text-base font-600']">
          批量评测 · {{ report.total }} 条 · 模式 {{ report.mode }} · 样本集 v{{ report.sampleSetVersion }}
          <span :class="['text-xs font-400 text-neutral-500 dark:text-neutral-400']">
            · 上次运行 {{ reportAt ? new Date(reportAt).toLocaleTimeString() : '未知' }}
          </span>
        </h2>

        <!-- 一行样本、两列判定（§9.3）。分类器来自这份报告。
             它自己的批量运行，两边都跑过才有三列。 -->
        <p :class="['text-xs text-neutral-500 dark:text-neutral-400']">
          统一逐条结果按样本 ID 合并：两列判定来自同一次报告。
        </p>

        <!-- 样本与报告以服务端为准（§9.4）；登录不可用时退回内置样本，页面说明当前读的是哪一份。 -->
        <div :class="['flex flex-wrap items-center gap-2']">
          <Button
            size="sm"
            variant="secondary"
            :loading="importingSamples"
            label="把内置样本导入服务端"
            @click="importBuiltinSamples"
          />
          <Button
            size="sm"
            variant="secondary"
            :loading="runsLoading"
            :label="runsLoading ? '刷新中…' : '刷新运行历史'"
            @click="refreshRuns"
          />
          <span :class="['text-xs text-neutral-500 dark:text-neutral-400']">
            {{ sampleSourceLabel }} · {{ evaluationSamples.length }} 条 · 样本集 v{{ evaluationSetVersion }}
          </span>
          <span v-if="serverSamplesError" :class="['text-xs text-amber-700 dark:text-amber-400']">
            服务端样本不可用（{{ serverSamplesError }}），当前用内置样本
          </span>
          <span v-if="runPersistError" :class="['text-xs text-red-600 dark:text-red-400']">
            本次运行没有写入历史：{{ runPersistError }}
          </span>
        </div>

        <!-- 一份可以交出去的报告：三方指标、分母、分组、错例与门槛结论。 -->
        <div :class="['flex flex-wrap items-center gap-2']">
          <Button
            size="sm"
            variant="secondary"
            label="导出报告（Markdown）"
            :disabled="!reportMarkdown"
            @click="downloadReport"
          />
          <span :class="['text-xs text-neutral-500 dark:text-neutral-400']">
            含三方指标与发布门槛对照、分组统计、错例摘要与结论；数值与上表同源
          </span>
        </div>

        <details
          v-if="reportMarkdown"
          :class="[
            'rounded-2xl border px-4 py-3 text-sm',
            'bg-white dark:bg-neutral-900',
            'border-neutral-200 dark:border-neutral-700',
          ]"
        >
          <summary :class="['cursor-pointer font-500']">
            预览报告
          </summary>
          <pre :class="['mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-words font-mono text-[10px] leading-relaxed']">{{ reportMarkdown }}</pre>
        </details>

        <div :class="['flex flex-wrap items-center gap-2']">
          <Button
            v-for="item in batchFilters"
            :key="item.value"
            size="sm"
            :variant="batchFilter === item.value ? 'primary' : 'secondary'"
            :label="item.label"
            @click="batchFilter = item.value"
          />
          <span :class="['text-xs text-neutral-500 dark:text-neutral-400']">
            {{ filteredRows.length }} / {{ batchRows.length }} 条
          </span>
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
                <th :class="['px-2 py-1 font-500']">
                  耗时
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="metricRow in batchMetrics"
                :key="metricRow.label"
                :class="['border-t border-neutral-200 dark:border-neutral-800']"
              >
                <td :class="['px-2 py-1 font-500']">
                  {{ metricRow.label }}
                </td>
                <td :class="['px-2 py-1']">
                  {{ metricRow.recall }}
                </td>
                <td :class="['px-2 py-1']">
                  {{ metricRow.falsePositive }}
                </td>
                <td :class="['px-2 py-1']">
                  {{ metricRow.failure }}
                </td>
                <td :class="['px-2 py-1']">
                  {{ metricRow.uncertain }}
                </td>
                <td :class="['px-2 py-1 text-xs text-neutral-500 dark:text-neutral-400']">
                  {{ metricRow.denominators }}
                </td>
                <td :class="['px-2 py-1']">
                  {{ metricRow.duration }}
                </td>
              </tr>
            </tbody>
          </table>
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
                  规则
                </th>
                <th :class="['px-2 py-1 font-500']">
                  生成式
                </th>
                <th :class="['px-2 py-1 font-500']">
                  分歧
                </th>
                <th :class="['px-2 py-1 font-500']">
                  回流
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="row in filteredRows"
                :key="row.id"
                :class="['border-t border-neutral-200 dark:border-neutral-800']"
              >
                <td :class="['px-2 py-1 text-xs text-neutral-500 dark:text-neutral-400']">
                  {{ intentSampleGroupLabels[row.group] }}
                </td>
                <td :class="['px-2 py-1']">
                  <div>{{ row.input }}</div>
                  <div v-if="row.previous" :class="['text-[10px] text-neutral-500 dark:text-neutral-400']">
                    上文：{{ row.previous }}
                  </div>
                </td>
                <td :class="['px-2 py-1']">
                  {{ labelText(row.expected) }}
                </td>
                <td :class="['px-2 py-1']">
                  {{ decisionLabel(row.rules) }}
                </td>
                <td :class="['px-2 py-1']">
                  {{ decisionLabel(row.model) }}
                </td>
                <td
                  :class="[
                    'px-2 py-1 text-xs',
                    rowDisagrees(row)
                      ? 'text-amber-700 dark:text-amber-400'
                      : 'text-neutral-500 dark:text-neutral-400',
                  ]"
                >
                  {{ rowDisagrees(row) ? '不一致' : '一致' }}
                </td>
                <td :class="['px-2 py-1']">
                  <!-- One click copies this sample and its earlier turn back into
                       the shared input, so a disagreement can be reproduced. -->
                  <button
                    type="button"
                    :class="[
                      'text-xs underline decoration-dotted underline-offset-2',
                      'hover:text-primary-600 dark:hover:text-primary-400',
                    ]"
                    title="把这条样本和它的上文填回共用输入"
                    @click="fillFromRow(row)"
                  >
                    回填
                  </button>
                </td>
              </tr>
              <tr v-if="!filteredRows.length">
                <td :colspan="7" :class="['px-2 py-3 text-xs text-neutral-500 dark:text-neutral-400']">
                  {{ batchRows.length ? '这个筛选下没有样本' : '先跑一次测试集（分类），两列才能合并' }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <h2 :class="['text-base font-600']">
          分组指标
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
                <th :class="['px-3 py-2 font-500']">
                  模型失败
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
                <td :class="['px-3 py-2']">
                  {{ modelGroup(group.group)?.failures ?? '—' }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <template v-if="report.disagreements.length">
          <h2 :class="['text-base font-600']">
            分侧明细 · 两边不一致 · {{ report.disagreements.length }} 条
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
                    <!-- One click re-runs this error in the trial area above,
                         with the earlier turn the sample depends on. -->
                    <button
                      type="button"
                      :class="['text-left', 'underline decoration-dotted underline-offset-2', 'hover:text-primary-600 dark:hover:text-primary-400']"
                      title="填入上方试跑区"
                      @click="fillTrial(item)"
                    >
                      {{ item.sample.input }}
                    </button>
                  </td>
                  <td :class="['px-3 py-2']">
                    {{ labelText(item.sample.expected) }}
                  </td>
                  <td :class="['px-3 py-2']">
                    {{ labelText(item.rules.decision) }}
                  </td>
                  <td :class="['px-3 py-2']">
                    {{ modelLabel(item) }}
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
            分侧明细 · 规则漏判 · {{ report.rules.falseNegatives.length }} 条
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
                    <!-- One click re-runs this error in the trial area above,
                         with the earlier turn the sample depends on. -->
                    <button
                      type="button"
                      :class="['text-left', 'underline decoration-dotted underline-offset-2', 'hover:text-primary-600 dark:hover:text-primary-400']"
                      title="填入上方试跑区"
                      @click="fillTrial(item)"
                    >
                      {{ item.sample.input }}
                    </button>
                  </td>
                  <td :class="['px-3 py-2']">
                    {{ intentSampleGroupLabels[item.sample.group] }}
                  </td>
                  <td :class="['px-3 py-2']">
                    {{ labelText(item.rules.decision) }}
                  </td>
                  <td :class="['px-3 py-2']">
                    {{ modelLabel(item) }}
                  </td>
                  <td :class="['px-3 py-2 font-500', modelRecoveryClass(item)]">
                    {{ modelRecovery(item) }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </template>

        <template v-if="modelFailures.length">
          <h2 :class="['text-base font-600']">
            分侧明细 · 模型失败 · {{ modelFailures.length }} 条
          </h2>

          <p :class="['text-xs text-neutral-500 dark:text-neutral-400']">
            失败不产生标签，所以不进召回和误判的分子，但仍留在分母里。
          </p>

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
                    失败原因
                  </th>
                  <th :class="['px-3 py-2 font-500']">
                    规则
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="item in modelFailures"
                  :key="item.sample.id"
                  :class="['border-t border-neutral-200 dark:border-neutral-800']"
                >
                  <td :class="['px-3 py-2']">
                    <!-- One click re-runs this error in the trial area above,
                         with the earlier turn the sample depends on. -->
                    <button
                      type="button"
                      :class="['text-left', 'underline decoration-dotted underline-offset-2', 'hover:text-primary-600 dark:hover:text-primary-400']"
                      title="填入上方试跑区"
                      @click="fillTrial(item)"
                    >
                      {{ item.sample.input }}
                    </button>
                  </td>
                  <td :class="['px-3 py-2']">
                    {{ intentSampleGroupLabels[item.sample.group] }}
                  </td>
                  <td :class="['px-3 py-2']">
                    {{ item.model?.evidenceCodes.join(', ') ?? '—' }}
                  </td>
                  <td :class="['px-3 py-2']">
                    {{ labelText(item.rules.decision) }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </template>
        <h2 :class="['text-base font-600']">
          结果追溯
        </h2>

        <!-- What the numbers were produced with. Without these a report cannot
             be told apart from one made with another model or prompt. -->
        <div
          :class="[
            'grid grid-cols-1 gap-x-3 gap-y-1 rounded-2xl border px-4 py-3 text-sm sm:grid-cols-[10rem_1fr]',
            'bg-white dark:bg-neutral-900',
            'border-neutral-200 dark:border-neutral-700',
          ]"
        >
          <span :class="['text-neutral-500 dark:text-neutral-400']">模型</span>
          <span :class="['break-all font-mono text-xs']">{{ report.modelId || '未运行模型' }}</span>

          <span :class="['text-neutral-500 dark:text-neutral-400']">分类提示词</span>
          <span :class="['font-mono text-xs']">{{ report.classifierPromptDigest }}</span>

          <span :class="['text-neutral-500 dark:text-neutral-400']">运行时间</span>
          <span>{{ new Date(report.ranAt).toLocaleString() }}</span>

          <span :class="['text-neutral-500 dark:text-neutral-400']">分类器版本</span>
          <span>v{{ report.classifierVersion }}</span>
        </div>

        <div
          v-if="reportIsStale"
          :class="[
            'rounded-2xl border px-4 py-3 text-sm',
            'bg-amber-50/70 border-amber-200 dark:bg-amber-950/30 dark:border-amber-900',
          ]"
        >
          当前配置和这份报告不一致（模式、样本集、模型或分类提示词有一项变了），数字不可直接比较。重新跑一次。
        </div>
      </template>

      <!-- The full history is its own page; the bench keeps the newest run in view. -->
      <div :class="['flex flex-wrap items-center gap-3 text-sm']">
        <RouterLink
          to="/devtools/intent-routing/runs"
          :class="['text-primary-600 underline dark:text-primary-400']"
        >
          运行历史 · {{ runs.length }} 次{{ runs[0] ? `（最近：${runs[0].status} ${runs[0].mode}）` : '' }}
        </RouterLink>
        <Button size="sm" variant="secondary" :loading="runsLoading" label="刷新" @click="refreshRuns" />
      </div>

      <template v-if="records.length">
        <div
          :class="[
            'flex items-center justify-between',
          ]"
        >
          <h2 :class="['text-base font-600']">
            附：本次记录 · {{ records.length }} 条
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
