# 医学问题意图识别设计

状态：阶段一已完成，第二阶段进行中。第二阶段只验证 DeepSeek 的意图识别效果，暂不接入知识库和正式医学回复流程。

核心实现放在 `packages/stage-ui`。当前测试入口主要放在 `apps/stage-web` 的 Devtools 页面。

## 1. 当前目标

第一阶段已经使用规则匹配识别医疗场景。

第二阶段只增加大模型识别能力，用当前 DeepSeek 作为模型分类器。这个阶段不把 AIRI 改造成工作流智能体。

```text
测试文本
  -> 选择分类模式
       -> rules：使用现有规则
       -> model：调用 DeepSeek
       -> compare：同时运行规则和 DeepSeek
  -> 返回统一的 IntentDecision
  -> 展示或统计结果
```

第二阶段暂时不做：

- 知识库检索。
- 医学提示词切换。
- 新增医疗问题固定回复。
- 新增正式聊天流程分流。
- 通用工作流、节点编排或 DAG。
- `core-agent` 的发送流程改造。

第一阶段已经在 `packages/stage-ui/src/stores/chat.ts` 的发送入口接入医疗固定回复短路。第二阶段不删除、不扩大这段既有行为。第二阶段只在 Devtools 测试页直接调用分类器，因此模型评测不会进入正式聊天发送流程。

当前 `packages/stage-ui/src/libs/intent/medical-gate.ts` 存在未提交的固定回复文本改动。提交第二阶段前，必须先确认该文本是否保留完整的用户引导语。这个文本问题不属于 DeepSeek 分类器开发。

## 2. 为什么先只接模型

当前目标是回答一个问题：

> DeepSeek 能不能比现有规则更好地识别医疗场景？

如果同时加入规则、模型、知识库和提示词切换，就无法知道错误来自哪一层。

因此，第二阶段先让规则和模型分别处理同一批样本，再比较结果。确认模型有价值后，再决定是否进入正式聊天分流。

## 3. 分类模式

```ts
type IntentClassifierMode = 'rules' | 'model' | 'compare'
```

| 模式 | 行为 | 是否改变正式聊天 |
| --- | --- | --- |
| `rules` | 使用第一阶段的规则分类器 | 不新增行为 |
| `model` | 使用 DeepSeek 分类器 | 不新增行为 |
| `compare` | 同时运行规则和 DeepSeek，并展示差异 | 不新增行为 |

默认使用 `rules`。这里的“默认”只表示测试页的分类模式。它不表示关闭第一阶段已经存在的医疗固定回复短路。

`compare` 只用于内部评测。它可以同时调用两个分类器，但不把结果写入聊天 Store，也不改变第一阶段已有的回复行为。

## 4. 统一结果

规则分类器和模型分类器必须返回同一种结果格式。

```ts
interface IntentDecision {
  decision: 'medical' | 'chat'
  scene:
    | 'health-consultation'
    | 'medical-knowledge'
    | 'hospital-process'
    | 'non-medical'
  evidenceCodes: string[]
  source: 'rule' | 'model' | 'fallback'
  classifierVersion: number
}
```

| 字段 | 用途 |
| --- | --- |
| `decision` | 判断输入是否属于医疗场景 |
| `scene` | 记录更具体的场景，便于分析错误 |
| `evidenceCodes` | 记录规则命中项或模型返回的固定依据码 |
| `source` | 记录结果来自规则、模型或失败降级 |
| `classifierVersion` | 区分不同版本的分类器 |

第一阶段的规则结果继续保留。第二阶段不要求规则和模型使用不同的数据格式。

## 5. DeepSeek 分类器

模型直接复用当前项目的 DeepSeek Provider 和 `@xsai/generate-text`。

建议使用当前的 `deepseek-flash`。分类任务不需要开启 thinking，也不需要流式输出。

| 参数 | 建议值 |
| --- | --- |
| 模型 | 当前配置的 `deepseek-flash` |
| `temperature` | `0` |
| thinking | disabled |
| 流式输出 | 关闭 |
| 超时 | 1500–2000ms |
| 输出长度 | 100–200 tokens |
| 输入上下文 | 当前消息，必要时加最近 1–2 个回合 |
| 输出格式 | 单个 JSON 对象 |

模型提示词只要求它判断医疗场景，不要求它回答用户问题。

示例输出：

```json
{
  "decision": "medical",
  "scene": "health-consultation",
  "evidenceCodes": ["symptom_description"]
}
```

模型结果必须经过 Zod 解析。非法 JSON、非法枚举、超时和网络错误都返回 `source: 'fallback'`，并记录失败原因。

内部评测阶段可以让测试工具继续处理失败样本。正式聊天分流的失败策略留到下一阶段确定。

## 6. 文件安排

```text
packages/stage-ui/src/libs/intent/
├─ contract.ts
├─ classify-rules.ts
├─ classify-model.ts
├─ classify.ts
├─ evaluate.ts
└─ fixtures/
```

| 文件 | 职责 |
| --- | --- |
| `contract.ts` | 定义 `IntentDecision`、模式和版本号 |
| `classify-rules.ts` | 保留第一阶段规则逻辑 |
| `classify-model.ts` | 调用 DeepSeek 并解析结果 |
| `classify.ts` | 根据模式选择规则、模型或对比流程 |
| `evaluate.ts` | 使用标注集统计两种分类器的结果 |
| `fixtures/` | 保存脱敏的测试样本和人工标签 |

测试页面放在：

```text
apps/stage-web/src/pages/devtools/intent-routing.vue
```

测试页面只调用分类器和评测函数。不调用聊天 Store，不查询知识库，不发送真实聊天消息。它也不经过 `chat.ts` 的发送入口，因此不会触发医疗固定回复短路。

## 7. 简单开发步骤

### 7.1 统一规则分类器的输出

将第一阶段规则分类器的返回值调整为 `IntentDecision`。

确认规则结果包含：

- `decision`。
- `scene`。
- `evidenceCodes`。
- `source: 'rule'`。
- `classifierVersion`。

这一阶段不改变规则判断逻辑。

### 7.2 增加 DeepSeek 分类器

新增 `classify-model.ts`。

它负责：

1. 组装分类提示词。
2. 获取当前 DeepSeek Provider。
3. 使用 `generateText` 发起非流式请求。
4. 解析模型返回的 JSON。
5. 用 Zod 校验字段。
6. 返回统一的 `IntentDecision`。

模型分类器不调用聊天 Store，也不负责知识库和回复生成。

### 7.3 增加模式选择

在 `classify.ts` 中增加三个模式：

```text
rules   -> 只运行规则
model   -> 只运行 DeepSeek
compare -> 规则和 DeepSeek 都运行
```

`compare` 的结果可以包含：

```ts
interface IntentComparison {
  rules: IntentDecision
  model: IntentDecision
  sameDecision: boolean
  durationMs: {
    rules: number
    model: number
  }
}
```

### 7.4 复用第一阶段评测数据

用同一批标注样本分别运行：

```text
rules -> 规则结果
model -> DeepSeek 结果
compare -> 两者差异
```

需要统计：

- 医疗问题召回率。
- 普通闲聊误判率。
- 漏判样本。
- 误判样本。
- 模型失败率。
- 规则耗时和模型耗时。

### 7.5 更新内部测试页

测试页增加：

- 分类模式选择。
- 单条文本测试。
- 上下文输入。
- 规则结果展示。
- DeepSeek 结果展示。
- 规则和模型的差异展示。
- 分类耗时和失败原因展示。

测试页不改变正式聊天行为。

## 8. 测试范围

| 测试对象 | 必测内容 |
| --- | --- |
| 规则分类器 | 第一阶段已有样本继续通过 |
| 模型分类器 | 正常 JSON、代码围栏、非法 JSON、非法字段 |
| 模型调用 | 超时、网络错误和空响应 |
| 模式选择 | `rules`、`model`、`compare` 分支正确 |
| 评测函数 | 召回率、误判率和错例统计正确 |
| 测试页面 | 可以切换模式并查看两种结果 |

自动化测试中的模型请求使用 mock。自动化测试不能调用真实 DeepSeek，也不能依赖真实 API Key。

内部评测与自动化测试分开处理。内部评测可以在 Devtools 页面调用真实 DeepSeek，用于运行标注集和比较规则结果。内部评测必须使用测试数据或脱敏数据，不能把结果写入正式聊天流程。没有 API Key 或不希望产生外部请求时，可以使用 mock 重放同一批样本，但 mock 结果不能替代真实模型效果评估。

## 9. 本阶段完成标准

第二阶段这一部分完成后，应满足：

1. 规则和模型可以使用同一批样本评测。
2. 可以单独查看 DeepSeek 的医疗场景识别结果。
3. 可以直接比较规则和 DeepSeek 的差异。
4. DeepSeek 失败时，测试工具仍然可以继续运行。
5. 测试页默认模式仍然是 `rules`。
6. 不新增或扩大正式聊天分流。
7. 评测请求不发送真实聊天消息。
8. 评测流程不查询知识库。
9. 评测流程不切换医学提示词。
10. 不修改 `core-agent`。
11. 不需要工作流引擎。

## 10. 下一阶段

医疗咨询分流、角色卡医疗 agent 与评测页改造的可执行设计见 [medical-consultation-routing.md](./medical-consultation-routing.md)。本文件的“不修改 `core-agent`”等限制仅适用于第二阶段，不约束新设计。下方保留当时的下一阶段设想。

只有当 DeepSeek 的识别效果经过标注集验证后，才进入下一阶段：

```text
用户发送
  -> DeepSeek 判断医疗场景
  -> 医疗场景：查询知识库并使用医学提示词
  -> 非医疗场景：继续原来的聊天流程
```

本阶段不提前实现这部分内容。
