# 医疗咨询分流：C 阶段实施步骤

标签：开发中 · 实施步骤 · C 阶段

状态：C1 设置、同名卡切换与预览待测试，端上核验待做；C2 的卡包保留和消息基础标识待测试，文案与界面收尾待做。目标与完成标准见 [medical-consultation-routing.md](./medical-consultation-routing.md) 第 6、8 节。B 阶段的接线步骤见 [medical-consultation-routing-stage-b.md](./medical-consultation-routing-stage-b.md)。

## 0. 拆分与约定

C 阶段拆成两半，按顺序做：

| 阶段 | 交付物 | 完成标准 |
| --- | --- | --- |
| C1. 设置页 | 可以打开、编辑、保存 `agents.medical` 的页面，并从 `/settings` 进入 | 保存后切页、刷新、切换角色卡都读到新值；缺项有明确原因 |
| C2. 卡包与标识 | 角色卡包保留 `agents`、聊天里的医疗标识、统一中文用户文案 | 导出再导入不丢配置；同一张卡在不同环境表现一致 |

约定：

- 实现期间不建 commit。
- 每一步结束运行该包的 typecheck、相关 Vitest 和 ESLint。
- 页面与医疗回复只维护中文；C2 核对固定回复、设置页和消息标识的用词是否一致。
- 部署开关 `VITE_MEDICAL_GENERATION` 仍默认 `off`。设置页只负责角色卡这一层，不替部署开关做决定。

## C1 医疗咨询设置页

目标：让人不碰控制台就能读写当前角色卡的医疗 agent 配置，并看清"为什么现在不生成"。

### C1.1 纯逻辑

- `packages/stage-ui/src/libs/intent/route.ts`：把内部的 `medicalAgentProblem()` 导出，页面和路由共用同一套判定，避免两处规则漂移。
- 新增 `packages/stage-ui/src/libs/intent/medical-agent.ts`：
  - `normalizeMedicalAgent(input)`：只保留 `enabled` 和 `prompt`，`prompt` 去首尾空白，未知字段丢弃。导入的卡片和手输的表单都经过它。
  - 单测覆盖：缺字段、多余字段、空白提示词、`enabled` 非布尔值。

### C1.2 角色卡写入

- `packages/stage-ui/src/stores/modules/airi-card.ts`：新增 `updateActiveCardMedicalAgent(agent)`，走现有的 `updateActiveCardModules()` 同款写法：写 `cards`，活动卡再 `applyActiveCardSettings()`。
- 传 `undefined` 表示清除配置，回到"没有医疗 agent"的状态。
- 单测由 C2 的编辑链路补；本步先靠页面手测保存与刷新。

### C1.3 页面与菜单

- 新增 `packages/stage-pages/src/pages/settings/medical-consultation.vue`，并在 web 与桌面应用各建路由入口。路由为 `/settings/medical-consultation`，配置 `meta.settingsEntry: true`，让 `/settings` 首页列出入口。
- 页面四块内容：

| 区块 | 内容 |
| --- | --- |
| 状态 | 部署开关三个取值的中文含义、当前角色卡名、当前聊天模型、缺项原因 |
| 人格 | `enabled` 开关、`agents.medical.prompt` 编辑框、清空按钮 |
| 约束 | 只读展示 `medicalBehaviorConstraints`，说明卡片不能覆盖 |
| 保存 | 保存按钮、保存后状态、未保存改动时离开提示 |

- 缺项原因按 `medicalAgentProblem()` 的返回值映射：未配置、未启用、提示词为空；再加一条部署开关关闭。

### C1.4 验收

- `pnpm -F @proj-airi/stage-ui exec vitest run src/libs/intent`
- `pnpm -F @proj-airi/stage-web typecheck`
- `pnpm -F @proj-airi/stage-tamagotchi typecheck`；设置页位于两端共用的 `stage-pages` 包。
- 真机：`/settings` 里能看到入口；填写提示词并保存；刷新页面后仍在；切换到别的角色卡再切回来，配置跟着卡片走。
- 切卡测试：用两张同名、不同 ID 的角色卡切换。表单必须加载目标卡的配置，不能保留前一张卡的草稿。
- 状态测试：没有当前模型或 Provider 时，页面不得显示“可以生成”。状态文案须区分“配置允许进入医疗分支”和“模型实际可用”。

### C1.5 待测试的内容

- 路由入口不需要单独文件：两端的 `routesFolder` 都包含 `packages/stage-pages/src/pages`，所以页面文件本身就会生成 `/settings/medical-consultation`。web 的 `typed-router.d.ts` 已登记该路径；桌面端只排除了 account / connection / data / models 四个设置页，本页不在排除列表里。
- 页面：`packages/stage-pages/src/pages/settings/medical-consultation.vue`，四块（状态、医疗助手人格、只读约束、保存）。
- 状态块显示部署开关三个取值、当前角色卡、当前模型；只有会被拦截时才显示一条黄色提示，逐条列出原因（部署开关未开 / 未填配置 / 开关关闭 / 提示词为空 / 没有选中的聊天模型）。不再声明"可以生成"，那件事这个页面保证不了。
- 保存走新增的同步 action `updateActiveCardMedicalAgent()`，写入活动角色卡并立即应用到运行时；保存成功后显示"已保存"，切换角色卡会重新载入该卡的值。
- 离开页面时若有未保存改动，弹 `AlertDialog` 确认，不用 `window.confirm`（仓库 ESLint 禁止）。
- 纯逻辑：`libs/intent/medical-agent.ts` 的 `normalizeMedicalAgent()`，单元测试覆盖空值、未知字段、非布尔开关、空白提示词。
- `route.ts` 的 `medicalAgentProblem()` 改为导出，页面和路由共用同一套判定。

未做（仍在 C1 范围）：

- 预览块。它要复用整条路由链路，单独作为下一步。
- web 与桌面端的设置菜单、直达路径、同名卡切换和保存后刷新仍需端上核验。同名卡切换的监听已改为 `activeCardId`。

## C2 卡包与标识

目标：让配置能跟着角色卡包走，并让人在聊天里看出这一轮是医疗咨询。

### C2.1 待测试：消息分支标识

- `packages/stage-ui/src/components/scenarios/chat/components/assistant-item.vue`：
  - 普通医疗回答带轻量"医疗咨询"标签（青色），下面一行 10px 小字："以上是普通健康指引，不能替代医生诊断。症状加重或出现紧急情况，请立即就医。"
  - 急症改为独立卡片：红底白字的行动条"立即就医 · 请前往急诊或拨打 120"放在正文之前，气泡换成红边红底；不再重复"急诊指引"标签，说明文字改为"以上不是诊断结论，不能替代医生面诊。"，避免和行动条重复 120。
  - 兜底保留"兜底回复"中性标签和小字说明。
  - 医疗 / 急症 / 兜底的气泡左侧各有一条同色竖条；普通闲聊没有任何标识。
  - 新增消息详情入口：医疗、急症、兜底三种气泡底部有一个"详情"按钮，展开后显示"本轮使用医疗咨询 / 急诊指引 / 兜底回复"和一句中文原因（如"承接了上一轮的急症描述"）。原因码（`red_flag`、`agent_disabled` 等）不直接显示给用户，未知码不显示该行；提示词原文不显示。
- `packages/stage-ui/src/components/scenarios/chat/components/history.vue`：把会话消息上的 `route` 传给气泡。
- `packages/stage-ui/src/types/chat.ts`：补导出 `TurnRoute`、`TurnRouteKind`、`TurnRouteResult`。
- 流式回答也带标识：运行时在路由完成后就把 `route` 写到流式消息上，不必等回答结束。
- 控制台另有一行 `[medical-consultation] route`，带 `kind`/`reason`/`answer`/提示词摘要，作为排查入口。
- 每个助手气泡带 `data-route-kind` 属性，便于在 DevTools 里核对分支。

未做：端上确认三种气泡的外观与详情展开，以及深色模式下的对比度。

### C2.2 卡包与文案

- `packages/stage-ui/src/services/airi-card-import-export.ts` 已按形状保留其他 agent；`agents.medical` 走 `normalizeMedicalAgent()`。
- 卡包往返测试已覆盖启用、关闭、空医疗条目和其他 agent。仍需核验设置页保存后导出、重新导入并显示同一配置的完整链路。
- `packages/stage-ui/src/services/airi-card-editor.ts`：确认编辑链路不丢 `agents`（现已有测试守着）。
- 聊天界面（待测试）：急症卡片突出"立即就医"动作；点消息详情可查看"本轮使用医疗咨询"这一事实。
- 中文文案（已核对，只维护中文）：同一状态用同一说法——急症一律"立即就医 / 急诊 / 拨打 120"，与 `medicalGateUrgentReply`、行为约束第 7 行、设置页预览文案一致；医疗免责统一"不能替代医生诊断"，兜底统一"这一轮没有生成医疗回答"。急症说明不再重复 120，避免行动条与说明各说一遍。
- 发布说明：A 阶段门槛通过后，把部署开关从 `dev` 改成 `on` 才会在正式环境生成医疗回答；这一步单独记录，不和代码改动混在一起。

## 下一步：让现有功能可用

N1、N2、N3、N4 和 B 阶段安全前置待测试；剩下的都是端上核验，不是代码。下列 N1—N4 保留原开发目标，具体状态与已确定的方案以“评审后的执行顺序”为准。共用页面已由两端的 `routesFolder` 纳入路由，无需另建入口文件。

### N1. 同名角色卡切换时重置表单（待测试）

- 原问题：页面曾监听 `activeCard.name`，两张同名不同 ID 的卡互换时表单不重载。
- 当前实现：`packages/stage-pages/src/pages/settings/medical-consultation.vue` 已监听活动角色卡 id（`cardStore.activeCardId`），切卡丢弃草稿时显示提示。
- 验收：造两张同名卡，各自配不同提示词，来回切换后表单分别显示各自的值。
- 测试：组件级不易做，至少保留一条手测记录在提交信息里。

### N2. 角色卡包保留 `agents`（待测试）

- 原问题：`sanitizeAiri()` 曾把 `agents` 写成 `{}`，导致配置导出后丢失。
- 当前实现 `packages/stage-ui/src/services/airi-card-import-export.ts`：
  - 按形状保留有 `prompt` 的其他 agent，保留其布尔 `enabled`；不按名称删除未知项。
  - `medical` 走 `normalizeMedicalAgent()`；没有有效提示词的空条目丢弃。`enabled: false` 且有提示词的配置保留。
- 测试 `airi-card-import-export.test.ts`：
  - 往返保留 `enabled: true` + 非空提示词；
  - `enabled: false` + 非空提示词往返后仍是关闭状态（不能被规范化成"丢弃"）；
  - 有效的未知 agent 条目保留；
  - 空条目往返后为 `{}`。
- 验收：设置页填好 → 导出卡包 → 重新导入 → 设置页仍显示同一份提示词和开关状态。

### N3. 预览块（待测试）

- 原目标：改完提示词立刻看到一条示例回答，不写进聊天历史。
- 当前实现：
  - 新增 `packages/stage-ui/src/libs/intent/preview.ts` 的 `previewMedicalTurn()`：先跑 `classifyRules()`，再调用正式的 `routeMedicalTurn()`，因此分流判定与提示词组装都来自同一套代码，页面里没有第二条链路。
  - 分支确定后若需要生成，模块才发起一次 `generateText` 请求（`max_tokens: 600`、30 秒超时）；固定回复、急症指引和普通聊天三种分支都不发请求。
  - 模块不读聊天 store：没有会话、队列、记忆写入、绘图任务和云同步。失败返回 `failure` 字段，不抛异常。
  - `packages/stage-pages/src/pages/settings/medical-consultation.vue` 新增「预览」区块：示例问题输入框、预览按钮、本轮分支（含 `reason`）、固定回复或生成回答、失败原因，并写明"预览结果只显示在这里，不会写入聊天会话"。
  - 预览读的是表单草稿（`enabled`、`prompt`），不需要先保存；缺项时按钮禁用并逐条说明原因（部署开关、开关关闭、提示词为空、没有选中的聊天模型）。
- 测试 `preview.test.ts` 6 条：开关关闭时走固定回复且不发请求；急症不发请求；闲聊只发分类请求；医疗轮次发分类 + 生成两次请求并返回回答；生成失败返回 `failure` 而不是抛出；卡片 agent 不可用时降级为固定回复。
- 未做：端上点一次预览并确认聊天页看不到该消息。
- 注意：一次预览最多两次模型调用（分类 + 生成），页面文案已写明。

### N4. 急症上下文继承（待测试）

- 原问题：`routeMedicalTurn()` 曾只看当前消息的 `red_flag`。"现在还是这样"承接上一轮的出血描述时不会升级为急症。
- 当前实现：
  - `packages/stage-ui/src/libs/intent/contract.ts` 增加证据码 `red_flag_inherited`；`classifierVersion` 升到 4，旧评测记录不能与当前结果直接比较。
  - `classify-rules.ts` 新增纯函数 `inheritedRedFlag(message, previousUserMessage)`。当前消息自带危险词时不继承（由 `classifyRules()` 报 `red_flag`）；上一轮没有危险词时不继承；命中转题词表（晚安、谢谢、不聊了等）时不继承；命中持续症状词表（还是、还在、一直、持续、止不住等）且上一轮有危险词时返回 `red_flag_inherited`。
  - `route.ts` 的 `hasUrgentSignal()` 把两种证据码都当作急症，`urgentReason()` 区分 `red_flag` 与 `red_flag_inherited`；`turn.ts` 的两处急症判断改为调用它，`medical-gate.ts` 同样认两种码，固定回复沿用急诊文案。
  - `chat.ts` 的 `routeTurn()` 取历史里最近一条用户消息作为上文，先试继承再退回 `classifyRules()`。更早的历史不参与，避免已处理过的警报反复触发。
- 测试：`classify-rules.test.ts` 与 `turn.test.ts` 共新增 8 条用例——持续症状继承急症；晚安、谢谢不继承；上一轮无危险词不继承；"已经不出血了"不继承；当前消息自带危险词仍报 `red_flag`；无上文不继承；继承结果在部署开关关闭和允许生成两种情况下都不等模型分类。
- 未定：两个词表是首版判断，需用真实对话样本复核；`anaphora` 证据码仍未使用。
- 验收：连续两轮手测，第二条显示"急诊指引"。真机核验未做。

### 2026-10-26 评审意见

N1、N2 和 B 阶段安全前置已经实现；其验收重点是两端页面可达、同名卡切换、卡包完整往返，以及文本、语音和重试的失败处理。不要按原评审建议重新实现它们。

N4 要定义指代与持续症状的判定，让 `routeMedicalTurn()` 和固定回复都识别 `red_flag_inherited`。测试“现在还是大量出血”“现在还是这样”“已经不出血了”“晚安”，避免漏判和重复警报。N3 要复用正式路由决策和提示词组装，测试预览不产生会话、记忆、绘图等副作用，并显示实际分支、失败原因与模型调用成本。

A 阶段分类评测和医疗回答人工审核通过前，只能在开发环境试跑，不能把部署开关改成正式启用。

### 评审后的执行顺序

按 2026-10-26 评审调整。括号里是依据。状态按 2026-10-26 当次实现更新。

1. **路由核验 + N1**（评审：只验证不改代码；N1 要聚焦测试）—— N1 待测试。
   - 在两端确认 `/settings` 菜单入口、`/settings/medical-consultation` 直达、保存后刷新仍在。已先核对：两端 `routesFolder` 都含 `packages/stage-pages/src/pages`，web 的 `typed-router.d.ts` 已登记该路径，桌面端排除列表不含本页；因此不需要新建应用侧路由文件，只需端上实测。
   - N1 已改为监听活动角色卡 id；切换丢弃未保存草稿时页面显示提示；比较基准改成"上次载入或保存的快照"，避免两张不同卡互换被误读成编辑。
2. **N2**（评审：先定 `agents` 的保留策略）—— 待测试。
   - 保留策略：按形状保留、不按名字过滤。未知 agent 只要有 `prompt` 就原样保留；`medical` 额外走 `normalizeMedicalAgent()`。
   - 「`enabled: false` + 空提示词」与「未配置」在规范化时合并为同一个状态，这是有意的产品选择：两者都不生成医疗回答，设置页也显示同一句原因。
3. **B 阶段安全前置**（对应主文档第 11 节 P1/P2）—— 待测试。
   - `onUserTurnReady` / `onAssistantTurnReady` 的载荷新增 `sessionId`，聊天 store 据此读本轮分支；医疗、急症、兜底轮次不再写长期记忆，也不再启动自主绘图任务。
   - `send()`、`ingest()`、`retry()` 统一走 `handleSendFailure()`：医疗轮次写一条兜底助手消息，其余分支保持原来的错误气泡。
   - 测试：医疗轮次不触发记忆与绘图；普通轮次仍然写入；提示词轮次空条目不误判。
4. **N4**（评审：`anaphora` 只有证据码，没有词表）—— 待测试。
   - 词表与接线见本节 N4；`routeMedicalTurn()` 与固定回复都把 `red_flag_inherited` 当急症处理。
   - 测试覆盖四条："现在还是大量出血"（自带危险词，报 `red_flag`）、"现在还是这样"（继承）、"已经不出血了"（不继承）、"晚安"（不继承）。
   - 未做：端上连续两轮手测。
5. **N3 预览**（评审：不能另拼一条链路）—— 待测试。
   - 由 `libs/intent/preview.ts` 复用正式路由决策与提示词组装，输入换成表单草稿，输出留在页面。
   - 不触发会话持久化、云同步、记忆、绘图、普通聊天工具；页面展示实际分支、失败原因和"会消耗模型调用"。
   - 未做：端上点一次预览，确认聊天页没有这条消息。

### 实现注意（踩过一次）

`packages/stage-ui` 解析的是 `@proj-airi/core-agent` 的 `dist`。改了 `core-agent/src` 之后必须跑 `pnpm -F @proj-airi/core-agent build`，否则 stage-ui 的类型检查和测试仍用旧产物；本轮 hook 载荷新增 `sessionId` 时就是这样发现为空值的。

### 已核对的评审条目

- **设置页状态检查模型与 Provider**：已修。状态块不再声明"可以生成"，拦截原因里含"没有选中的聊天模型"。
- **两端路由入口**：不需要新建文件，见上。真正待做的是端上实测。

### 本批不做

- A 阶段的验收集与标注复核：需要先定样本来源。
- D 阶段的试跑工作台与批量评测。
- 中文文案核对、急症独立卡片、消息详情入口、`error` 消息过滤、医疗轮次的 ACT 情绪标记。

## 未包含

- 单轮/多轮完整试跑、批量评测、错例回填：属于 D 阶段。
- 300 条验收集与急症集：属于 A 阶段，当前暂停。
