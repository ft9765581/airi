# 医疗咨询分流：C 阶段实施步骤

状态：C1 部分实现，C2 待实现。目标与完成标准见 [medical-consultation-routing.md](./medical-consultation-routing.md) 第 6、8 节。B 阶段的接线步骤见 [medical-consultation-routing-stage-b.md](./medical-consultation-routing-stage-b.md)。

## 0. 拆分与约定

C 阶段拆成两半，按顺序做：

| 阶段 | 交付物 | 完成标准 |
| --- | --- | --- |
| C1. 设置页 | 可以打开、编辑、保存 `agents.medical` 的页面，并从 `/settings` 进入 | 保存后切页、刷新、切换角色卡都读到新值；缺项有明确原因 |
| C2. 卡包与标识 | 角色卡包保留 `agents`、聊天里的医疗标识、用户文案迁 `i18n` | 导出再导入不丢配置；同一张卡在不同环境表现一致 |

约定：

- 实现期间不建 commit。
- 每一步结束运行该包的 typecheck、相关 Vitest 和 ESLint。
- 页面文案先写中文，和现有医疗回复保持一致；迁 `packages/i18n` 放在 C2，和固定回复一起做。
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

### C1.5 已实现的内容

- 共用页面已有 `/settings/medical-consultation` 的路由元数据草案。web 与桌面应用尚未建立对应页面入口，因此 `/settings` 首页目前不能据此列出"医疗咨询"。
- 页面：`packages/stage-pages/src/pages/settings/medical-consultation.vue`，四块（状态、医疗助手人格、只读约束、保存）。
- 状态块显示部署开关三个取值、当前角色卡、当前模型，以及"现在能生成吗"和逐条原因（部署开关未开 / 未填配置 / 开关关闭 / 提示词为空）。
- 保存走新增的同步 action `updateActiveCardMedicalAgent()`，写入活动角色卡并立即应用到运行时；保存成功后显示"已保存"，切换角色卡会重新载入该卡的值。
- 离开页面时若有未保存改动，弹 `AlertDialog` 确认，不用 `window.confirm`（仓库 ESLint 禁止）。
- 纯逻辑：`libs/intent/medical-agent.ts` 的 `normalizeMedicalAgent()`，单元测试覆盖空值、未知字段、非布尔开关、空白提示词。
- `route.ts` 的 `medicalAgentProblem()` 改为导出，页面和路由共用同一套判定。

未做（仍在 C1 范围）：预览块。它要复用整条路由链路，按 C1 文档单独作为下一步。

当前页面只监听角色卡名称的变化。同名角色卡切换时，表单可能不重置。当前“现在能生成吗”只检查部署开关和角色卡配置，未检查当前模型与 Provider。这两项修复后才能完成 C1 验收。

当前只有 `stage-pages` 中的页面文件，`apps/stage-web/src/pages/settings` 与 `apps/stage-tamagotchi/src/renderer/pages/settings` 都没有医疗咨询路由文件。两端接入后，分别验证菜单入口和页面直达。

## C2 卡包与标识

目标：让配置能跟着角色卡包走，并让人在聊天里看出这一轮是医疗咨询。

### C2.1 已实现：消息分支标识

- `packages/stage-ui/src/components/scenarios/chat/components/assistant-item.vue`：
  - 普通医疗回答不打标签，只在正文下面加一行 10px 小字："以上是普通健康指引，不能替代医生诊断。症状加重或出现紧急情况，请立即就医。"
  - 急症仍保留"急诊指引"红标签和红色小字："以上不是诊断结论。请立即前往急诊或拨打 120。"
  - 兜底保留"兜底回复"中性标签和小字说明。
  - 医疗 / 急症 / 兜底的气泡左侧各有一条同色竖条；普通闲聊没有任何标识。
- `packages/stage-ui/src/components/scenarios/chat/components/history.vue`：把会话消息上的 `route` 传给气泡。
- `packages/stage-ui/src/types/chat.ts`：补导出 `TurnRoute`、`TurnRouteKind`、`TurnRouteResult`。
- 流式回答也带标识：运行时在路由完成后就把 `route` 写到流式消息上，不必等回答结束。
- 控制台另有一行 `[medical-consultation] route`，带 `kind`/`reason`/`answer`/提示词摘要，作为排查入口。
- 每个助手气泡带 `data-route-kind` 属性，便于在 DevTools 里核对分支。

未做：急症"独立卡片"样式（现在只有红色标签与竖条）、消息详情入口、免责声明与标签的 i18n 迁移。

### C2.2 卡包与文案

- `packages/stage-ui/src/services/airi-card-import-export.ts`：`sanitizeAiri()` 的 `agents` 从硬写 `{}` 改为按字段校验后保留；`agents.medical` 走 `normalizeMedicalAgent()`。
- 卡包往返测试必须覆盖 `enabled: true`、非空提示词和关闭状态。当前清洗逻辑仍写入 `agents: {}`，所以 C1 设置页保存成功不等于卡包可保留配置。
- `packages/stage-ui/src/services/airi-card-editor.ts`：确认编辑链路不丢 `agents`（现已有测试守着）。
- 聊天界面：急症卡片突出"立即就医"动作；点消息详情可查看"本轮使用医疗咨询"这一事实。
- `packages/i18n`：两条固定回复、急症文案、设置页与消息标识的文案一并迁入，先英文源和开发者语言。
- 发布说明：A 阶段门槛通过后，把部署开关从 `dev` 改成 `on` 才会在正式环境生成医疗回答；这一步单独记录，不和代码改动混在一起。

## 未包含

- 单轮/多轮完整试跑、批量评测、错例回填：属于 D 阶段。
- 300 条验收集与急症集：属于 A 阶段，当前暂停。
