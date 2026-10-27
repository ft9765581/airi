# 医疗咨询分流：B 阶段实施步骤

标签：开发中 · 实施步骤 · B 阶段

状态：部分实现，待补审查问题并验收。目标与完成标准见 [medical-consultation-routing.md](./medical-consultation-routing.md) 第 3、5、8 节。本文件只拆解实施顺序、每一步的接口变化和验收方式。

## 0. 实施约定

- 四步按顺序执行。每一步结束时，该步的验收命令必须通过。
- B1 和 B2 不改变正式聊天行为。B3 接通路由，只在开发环境试跑；B4 补上多轮判断。
- `agents.medical.enabled` 是角色卡开关。另设默认关闭的部署开关；仅开发环境可先打开试跑。正式启用还须完成 B4，并通过主文档第 7 节的 A 阶段门槛。不能单靠角色卡开关上线医疗生成。
- 实现期间不建 commit。
- 每一步结束运行该包的 typecheck、相关 Vitest 和 ESLint。

| 步骤 | 目标 | 改变正式聊天行为 | 可停点 |
| --- | --- | --- | --- |
| B1 | `core-agent` 的路由与提示词契约 | 否 | 是。不传新接口时行为与现在相同 |
| B2 | 路由判定与医疗提示词（纯函数） | 否 | 是。尚未接线 |
| B3 | 发送入口统一，开发环境试跑 | 仅开发环境 | 是。正式环境继续固定回复 |
| B4 | 分类器输入带角色 | 开发环境多轮判断改善 | 是。通过 A 阶段门槛后再正式启用 |

## B1 core-agent 契约

目标：让运行时能在**出队后**决定这一轮走哪个分支、用哪段系统提示词，并在需要时直接写回复而不调用模型。

改动文件：

- `packages/core-agent/src/types/chat.ts`：`ChatHistoryItem` 增加可选字段 `route?: TurnRoute`（`kind` 加可选 `reason`），类型由同一所有者导出。
- `packages/core-agent/src/runtime/chat-orchestrator-runtime.ts`：
  - `buildProviderMessages()` 的字段解构加 `route`，否则新字段会直接进模型输入。
  - `performSend()` 在出队后、运行时上下文采集和模型消息组装之前调用新 dep `routeTurn`，使固定回复无需等待这些工作。
  - 本轮助手消息写入 `route` 元数据。

新增类型：

```ts
type TurnRouteKind = 'urgent' | 'medical' | 'chat' | 'fallback'

interface TurnRoute {
  kind: TurnRouteKind
  /** 走非 chat 分支的原因，例如分类降级。 */
  reason?: string
}

interface TurnRouteResult {
  route: TurnRoute
  /** 本轮替换用的完整系统消息。缺省表示沿用会话里的那条。 */
  systemPrompt?: string
  /** 存在时不调用模型，直接写入这条助手回复。 */
  reply?: string
  /** 跳过普通聊天的运行时上下文和不传工具。缺省 false；reply 分支恒为 true。 */
  isolate?: boolean
}
```

新增依赖（可选，不传时全流程与现在一致）：

```ts
interface ChatOrchestratorDepsExtension {
  /** 出队后决定本轮分支。不传时行为与现在一致。 */
  routeTurn?: (context: {
    sessionId: string
    message: string
    /** 本轮之前的消息，按时间正序的快照。当前消息单独传入。 */
    history: ChatHistoryItem[]
  }) => Promise<TurnRouteResult | undefined>
}
```

同时把入队参数改成两种形式之一，使"先入队、后解析模型"可以表达：

```ts
interface ChatOrchestratorCommonSendOptions {
  providerConfig?: Record<string, unknown>
  attachments?: { type: 'image', data: string, mimeType: string }[]
  tools?: StreamOptions['tools']
  toolReferences?: ChatToolReference[]
  input?: ChatStreamEventContext['input']
}

type ChatProviderTarget
  = | { model: string, chatProvider: ChatProvider }
    | { resolveChat: () => Promise<{ model: string, chatProvider: ChatProvider }> }

type ChatOrchestratorSendOptions = ChatOrchestratorCommonSendOptions & ChatProviderTarget
```

`routeTurn` 在 `ingestRuntimeContexts()` 之前执行，因为固定回复和隔离轮次不能采集只为模型准备的上下文；`route` 元数据写在助手消息上，`buildProviderMessages()` 会把它剥离。

`resolveChat` 只在 `routeTurn` 没有给出 `reply` 时调用。`reply` 分支不解析 Provider，所以急症和固定回复不依赖模型配置。分析埋点读取 `options.model` 的地方改用解析后的值。

`resolveChat` 在聊天 Store 的同步 `send` 动作内部创建，不放进跨窗口的 `ChatSendPayload`。用户消息、路由和模型解析均由队列当前轮次处理；当前轮取消或会话代际变化后不能再写回复。

行为要求：

- `routeTurn` 返回 `reply` 时，不调用 LLM 端口，只写一条助手消息。
- 固定回复仍写入用户消息与助手消息，并触发原有的云同步、轮次结束和清理钩子；埋点区分无模型的固定回复与模型成功。急症和固定回复不采集只供 LLM 使用的运行时上下文。
- `systemPrompt` 是**完整替换**，不是追加。现成的 `getSystemPromptSupplement` 保持追加语义不变，二者不合并；隔离轮次不追加这段补充，因为它描述的是本轮不传的工具。
- 替换只作用于本轮组装出的消息，不改写会话里保存的系统消息。
- 医疗生成不传普通聊天工具，也不拼接普通聊天的知识库、长期记忆等上下文；首版只使用必要的同会话对话历史和时间信息。
- 隔离还覆盖回合结束后的副作用。医疗、急症和失败兜底轮次不得触发普通长期记忆写入或普通聊天自主任务；把路由传给消费这些回调的代码。
- 没传 `routeTurn` 时，所有行为与现在相同。

验收：

- `pnpm -F @proj-airi/core-agent exec vitest run src/runtime/chat-orchestrator-runtime.test.ts`
- `pnpm -F @proj-airi/core-agent typecheck`

新增测试：不传 `routeTurn` 时行为不变；`reply` 时不调用 LLM、上下文提供者或 Provider，且各写一条用户和助手消息；固定回复的同步钩子正常触发；医疗 `systemPrompt` 替换后不残留卡片人格或工具集补充提示词；`route` 不出现在组装出的消息里。

## B2 路由判定与提示词

目标：把"识别结果 → 分支"和"提示词组装"做成两个纯函数模块，先不接线。

改动文件：

- 新增 `packages/stage-ui/src/libs/intent/route.ts`：`resolveTurnRoute()`。
  输入：规则结果（只为急症）、判定分支的 `IntentDecision`、`agents.medical`。
  输出：`{ route: TurnRoute, useAgent: boolean }`。`route.reason` 记录急症、降级或 agent 缺项的原因；`useAgent` 为 false 时调用方只能写固定回复。
- 新增 `packages/stage-ui/src/libs/intent/medical-prompt.ts`：
  - `medicalBehaviorConstraints`：应用维护的行为约束，卡片不可覆盖。
  - `composeMedicalSystemPrompt()`：按"通用格式约束 + 行为约束 + 卡片人格"拼一条系统消息，空段自动跳过。
  - `summarizePrompt()`：输出 `<8 位十六进制摘要>:<长度>`，写进路由记录，不落提示词原文。
- 新增 `packages/stage-ui/src/constants/prompts/chat-format.ts`：把原先写在 `session-store.ts` 里的通用格式约束提出来，供聊天和医疗共用。`session-store.ts` 的拼接结果不变。
- `libs/intent/classify-model.ts`：目前 `recentMessages` 是无角色字符串数组。本步先由路由层负责转换，接口在 B4 再改。

规则：

- 急症判定优先。急症只来自规则的 `red_flag`，模型结果不参与。
- 模型分类失败（`source === 'fallback'`）走 `fallback` 分支，不因规则命中普通医学词而改判 `medical`。
- `agents.medical` 缺失、`enabled !== true` 或提示词为空时，`medical` 分支降级为固定回复，原因分别是 `agent_missing`、`agent_disabled`、`prompt_empty`。`enabled` 必须显式为 `true`，旧卡片不会因升级自动开启。

验收：

- `pnpm -F @proj-airi/stage-ui exec vitest run src/libs/intent`
- 新增测试：四种分支、急症优先、agent 缺失/未启用/提示词为空、缺 `enabled` 视为未启用、失败不靠规则补判、提示词顺序、卡片覆盖约束无效、摘要稳定且不含原文。

## B3 发送入口统一

目标：所有入口都走同一条路由，急症和固定回复不再要求模型配置。

改动文件：

- 新增 `packages/stage-ui/src/libs/intent/medical-generation.ts`：部署开关 `VITE_MEDICAL_GENERATION`（`off` 默认、`dev`、`on`），未知值按 `off` 处理。
- 新增 `packages/stage-ui/src/libs/intent/turn.ts`：`routeMedicalTurn()` 把 B2 的路由结果变成运行时需要的 `route`、`reply`、`systemPrompt`、`isolate`；`failedTurnReply()` 给出生成失败时的兜底文案。
- `packages/stage-ui/src/libs/intent/medical-gate.ts`：`getMedicalGateReply(message)` 改为 `medicalGateReplyFor(decision)`，分类只做一次。
- `packages/stage-ui/src/stores/chat.ts`
  - `executeSend()` 不再在拦截前抛"未配置模型/Provider"。
  - 改为传 `resolveChat`，由运行时在出队后解析。
  - 接入 `routeTurn`：读取当前角色卡的 `agents.medical`，调用 B2 的三个模块，返回 `route`、`systemPrompt`、`reply`。部署开关默认关闭；开发环境把 `VITE_MEDICAL_GENERATION` 设为 `dev` 可试跑。
  - 生成失败只写一条兜底助手消息，不同时留下错误消息和兜底消息；失败原因仍进埋点与控制台。
  - `ingest` 的 `options` 变为可选，未传时由 store 解析 Provider，语音入口因此不再预先解析。
  - `retry` 复用 `executeSend`，重新走路由并写入新的分支记录。
- 发送入口：
  - `apps/stage-web/src/pages/index.vue`、`apps/stage-web/src/pages/nurse.vue`：去掉发送前的 Provider 预解析，直接 `chatStore.ingest(text)`。
  - `apps/stage-tamagotchi/src/renderer/components/InteractiveArea.vue`、`pages/index.vue`、`pages/spotlight.vue`：只传 `sessionId` 和文本，契约不变，typecheck 通过。
  - `packages/stage-ui/src/stores/markdown-stress.ts`：开发用途，仍传 model/provider，契约向后兼容。
- `packages/stage-ui/src/stores/chat.contract.test.ts`：新增三条规格——医疗消息写固定回复且不解析 Provider、未配置 Provider 时急症仍能回答、普通闲聊在无 Provider 时仍然报错。

验收：

- `pnpm -F @proj-airi/stage-ui exec vitest run`
- `pnpm -F @proj-airi/stage-web typecheck`、`pnpm -F @proj-airi/stage-tamagotchi typecheck`
- 真机：开发环境中将文本发送、语音输入、重试、`agents.medical` 开启与关闭各走一遍；正式环境仍验证固定回复。
- 回归测试：`send()`、`ingest()` 和 `retry()` 的医疗生成失败都只写一条兜底助手消息；同一会话的排队轮次不得互相读取失败分支。
- 回归测试：医疗、急症及失败兜底轮次不调用普通长期记忆写入或普通聊天自主任务；普通聊天保留现有行为。

## B4 分类器输入带角色

目标：让"那这个呢""需要复查吗"这类追问能结合上文判断。

改动文件：

- `packages/stage-ui/src/libs/intent/classify-model.ts`：新增 `ClassifyHistoryTurn { role, content }`；`ClassifyModelInput.recentMessages: string[]` 改为 `history?: ClassifyHistoryTurn[]`，取最近两条，并在提示里标成 `【上文用户】`、`【上文助手】`、`【当前用户消息】`。
- `packages/stage-ui/src/libs/intent/classify.ts`：`ClassifyRequest` 的字段同步改为 `history`。
- `packages/stage-ui/src/libs/intent/evaluate.ts`：`sample.previous` 映射为 `{ role: 'user', content: previous }`，因为标注集里的 `previous` 都是用户说过的句子。
- `packages/stage-ui/src/stores/chat.ts`：路由分类从会话历史取最近两条，并按原角色传入，助手说过的话不会被当成用户自己的主诉。
- `apps/stage-web/src/pages/devtools/intent-routing.vue`：页面的"上文"每行按用户发言传入。

验收：

- `pnpm -F @proj-airi/stage-ui exec vitest run src/libs/intent`
- 新增测试：两条上文按角色标注、当前消息单独成段。
- 一次真实调用：只发"那这个呢"时，带上医疗上文能判为医疗，带"晚安"上文能回到闲聊。
- 急症上下文：紧邻医疗上文含"大量出血"，当前消息明确表示"现在还是这样"时，先返回急诊指引；转题消息不继承急症。

## 未包含在本文件的部分

- 医疗消息标识、设置页、角色卡导入导出保留 `agents`：属于 C 阶段。
- 单轮/多轮试跑、批量评测、错例回填：属于 D 阶段。
- 发布门槛复测与验收集：属于 A 阶段，当前暂停。
- Embedding 分类的对照评测、组合策略与接入门槛见 [intent-routing.md](./intent-routing.md) 第 4—8 节。它不改变本文件 B1—B4 的当前接线。
