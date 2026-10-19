# Provider API Key 写入链路 Bug —— 排查结论与修复方案

状态：**已定位，未修复**。本文是双方（人工排查 + 另一位审阅者）合流后的结论，供实施时使用。

---

## 1. 用户报告的现象

在语音服务来源页面（例：`/settings/providers/speech/mimo-audio-speech`）输入 API Key 后：

1. 输入框里能看到 Key
2. 但一直提示「需要填写 API Key 才能用哦！」
3. 刷新页面后 Key 丢失

对照：DeepSeek 页面（`/settings/providers/chat/deepseek`）输入 Key **能立即持久化**。

---

## 2. 根因（三个独立问题叠加）

### 2.1 `configs` 是派生投影，不能被写

```ts
// packages/stage-ui/src/stores/providers/config.ts:100
const configs = computed(() => Object.fromEntries(
  Object.entries(providers.value).map(([providerId, provider]) => [providerId, provider.config]),
))
```

`configs` 由 `Object.fromEntries` 生成，是**派生对象**。页面普遍这样写：

```ts
const { configs: providers } = storeToRefs(providerStore) // ← 别名掩盖了真实结构
providers.value[providerId] = { ...record } // ❌ 改的是派生对象
```

**实测证据**：在页面注入 `Storage.prototype.setItem` 探针，连续采样 10 秒，`settings/providers/configured` 的**写入次数 = 0**。

对照：`providers.value[providerId].apiKey = value`（对 `record.config` 的**嵌套修改**，是别名）→ **实测立即持久化成功**（DeepSeek 页面走的就是这条路径）。

> 推论：`providers.value[id] = {...}` 只改到 `computed` 缓存里的对象，永不落库。

### 2.2 层级写错：`record.apiKey` vs `record.config.apiKey`

真实结构：

```ts
const record = { id: 'mimo-audio-speech', definitionId: 'mimo-audio-speech', config: { apiKey: '', baseUrl: '' }, status: 'unconfigured', configuredBy: 'user' }
```

但 `speech-provider-settings.vue:129-138` 把 `apiKey` / `baseUrl` / `voiceSettings` 写到了**记录顶层**：

```ts
const debouncedUpdate = useDebounceFn(() => {
  providers.value[props.providerId] = {
    ...providers.value[props.providerId],
    apiKey: apiKey.value, // ❌ 应为 config.apiKey
    baseUrl: baseUrl.value,
    voiceSettings: { ...voiceSettings.value },
  }
}, 1000)
```

即使写进去了，读取方（`apiKeyConfigured = !!providers.value[id]?.apiKey` 读投影、`getProviderConfig()` 读 `record.config`）也读不到 → 红字永不消失。

### 2.3 Provider 实例缓存不会因改 Key 而失效

```ts
// provider.ts:97
const providerInstanceCache = new Map<string, unknown>() // 按 providerId 缓存
```

`getProviderInstance()`（provider.ts:770）命中缓存直接返回，**不比较凭据**。而本应负责失效的函数：

```ts
// provider.ts:687
async function refreshModelsForChangedCredentials() {
  // 对比凭据 hash → disposeProviderInstance(providerId) → 必要时重取模型
}
```

**全仓库没有任何调用者**（只有 `provider.test.ts:63` 里 spy 过一次）。

→ 改 Key 后**必须刷新页面**才会用上新 Key。

### 2.4 附带的判断口径不一致

| 位置 | 写法 | 数量 |
|---|---|---|
| Provider 定义（校验用） | `!!config.apiKey?.trim()` ✅ | 40+ |
| 页面（UI 判断用） | `!!providers.value[id]?.apiKey` ❌ 无 trim | 16 |

→ 只输入空格时，UI 说"已配置"，校验说"无效"。

---

## 3. 代码分布（盘点，用于分批修复）

| 类别 | 说明 | 数量 | 例子 |
|---|---|---|---|
| **A. 整条替换投影** | 必须修 | 少量 | `speech-provider-settings.vue:130`、`transcription-provider-settings.vue:45/55`、`onboarding.vue:107`、`use-provider-validation.ts:247` |
| **B. 在投影里创建空对象** | `providers.value[id] = {}` | ~50 | 各 provider 页面的 `ensureProviderConfig()` |
| **C. 仅读取** | 只改 trim 口径 | 16 | 各页面的 `apiKeyConfigured` |

搜索命令：

```bash
rg -n "providers\.value\[.*\] = \{" packages/
```

---

## 4. 修复方案（双方合流后）

### 4.1 Store 增加局部字段更新入口

**注意命名冲突**：store 里**已有**

```ts
// config.ts:211（已在 synced.actions 中）
async function updateProviderConfig(providerId, config /* 完整配置 */, status) { /* … */ }
```

它负责「保存完整配置 + 状态 + 远端同步」。因此局部字段 patch 必须用**不同名字**，建议：

```ts
/** 更新某个 Provider 配置中的部分字段；记录不存在时先创建。 */
function patchProviderConfig(providerId: string, patch: Record<string, unknown>) {
  const definitionId = resolveDefinitionId(providerId) // 复用 config.ts 既有的 vision- 前缀规则
  const record = providers.value[providerId] ?? ensureProvider(providerId, definitionId)
  Object.assign(record.config, patch) // 原地改：实测嵌套修改可触发持久化
}
```

要点：

- **必须调用 `ensureProvider()` 创建记录**，否则"记录不存在"场景静默失败
  （注意：既有 `updateProviderConfig` 与 `setProviderStatus` 都是 `if (!provider) return`，同样会静默失败）
- 用 `Object.assign(record.config, patch)` 原地改，而不是整体替换记录
- **只在这里规范化 API Key**（`trim()`），其他字段按原值保存；不要逐页散落 trim

### 4.2 三个共享写入点改走该入口

- `speech-provider-settings.vue`（`apiKey`/`baseUrl` getter+setter、`debouncedUpdate`、`initializeVoiceSettings`）
- `transcription-provider-settings.vue`（`apiKey`/`baseUrl`、`onMounted`）
- `use-provider-validation.ts`（`handleResetSettings` 的 `providers.value[id] = {...defaultOptions}`）

保留既有语义：**空值不创建记录**（否则"打开过页面"会被误判为"已配置"）。

### 4.3 缓存失效落在 `provider.ts`

```ts
// provider.ts 内：凭据签名变化 → await refreshModelsForChangedCredentials()
```

- **不能**把 `disposeProviderInstance` 放进 `config.ts` 的写入流程：`provider.ts:35` 已 `import ... from './config'`，反向调用会**循环依赖**
- **不能**逐键无条件 dispose：`refreshModelsForChangedCredentials()` 已用 **hash 比较**做了"只在真正变化时失效" ✅
- 该函数声明在 `synced.actions` 中，按仓库规范 watcher 调用它**必须 await**

### 4.4 校验链路**不需要新增**

`use-provider-validation.ts:236-243` **已经**在监听凭据签名并防抖校验：

```ts
const credentialsSignature = computed(() => JSON.stringify(credentials.value))
watch(credentialsSignature, () => debouncedValidateConfiguration())
```

（注释解释了为何监听序列化签名而非深对象：避免同步快照触发死循环。）

⚠️ 不要改成"每次配置更新都调用校验" —— 会在每次防抖按键上发一次校验请求，触发 **API 计费/限流**（现有代码专门注释了这一点）。

### 4.5 分批，不机械改 28 个页面

按第 3 节的 A → B → C 分类推进；先把 A 类修完（解决用户报告的问题），再盘点 B 类。

---

## 5. 待定位（尚未解释清楚的现象）

`initializeProvider()` 在**代码上**会创建配置记录：

```ts
// provider.ts:375
async function initializeProvider(providerId: string) {
  await waitForProviderMetadata()
  if (!providerCredentials.value[providerId]) {
    providerConfigStore.ensureProvider(providerId, getProviderDefinitionId(providerId), getDefaultProviderConfig(providerId))
  }
  initializeProviderRuntimeState(providerId)
}
```

共享组件 `onMounted` 里也确实调用它。**但实测对不上**：删除 MiMo 记录 → 重载页面 → 不做任何输入，等 25 秒，`localStorage` 里**始终没有记录**：

```
挂载后约 6s / 12s / 18s / 25s：{"存在":false}
```

候选原因（**未区分，勿凭推断下结论**）：

1. `await waitForProviderMetadata()` 未返回（该 provider 元数据未就绪，后面那句没执行）
2. synced store 的动作路径 —— `ensureProvider` 是**同步**函数，却列在 `synced.actions` 中（按规范那里只应放异步动作）

**影响**：决定"记录不存在"场景是否需要额外处理。

---

## 6. 验证清单（Vitest + 浏览器实测）

Vitest（`packages/stage-ui/src/stores/providers/config.test.ts` 已存在）：

1. 记录不存在时，首次写入会**创建**记录
2. API Key 持久化在 `record.config.apiKey`
3. Reset 正确恢复默认值（且不经投影）
4. 凭据变化触发旧实例失效
5. **凭据未变化不重复失效**（负向用例）
6. 校验仍按既有防抖链路运行
7. 空白 Key 不写入、也不被视为"已配置"

浏览器实测（每步留证据）：

1. MiMo 页输入 Key → `setItem` 探针计数 **> 0** + 红字消失 + 刷新后仍在
2. 先让实例创建 → 改 Key → **不刷新**再请求 → 抓请求头确认用的是**新 Key**
3. 输入 `"   "` → UI 仍显示"未配置"
4. 回归：DeepSeek 页面（原本正常的路径）不能被改坏

---

## 7. 相关文件索引

| 文件 | 行 | 内容 |
|---|---|---|
| `packages/stage-ui/src/stores/providers/config.ts` | 100 | `configs` 派生投影 |
| | 122 | `ensureProvider()` |
| | 211 | 既有的 `updateProviderConfig(providerId, config, status)` |
| `packages/stage-ui/src/components/scenarios/providers/speech-provider-settings.vue` | 59-77 | `apiKey` / `baseUrl` setter 写投影 |
| | 129-141 | `debouncedUpdate` 整体替换 |
| `packages/stage-ui/src/components/scenarios/providers/transcription-provider-settings.vue` | 41-59 | 同上 |
| `packages/stage-ui/src/composables/use-provider-validation.ts` | 236-243 | 已有的签名监听 + 防抖校验 |
| | 247 | Reset 写投影 |
| `packages/stage-ui/src/stores/providers/provider.ts` | 97 | `providerInstanceCache` |
| | 375 | `initializeProvider()` |
| | 687 | `refreshModelsForChangedCredentials()`（**无调用者**） |
| | 770 | `getProviderInstance()` |
| `packages/stage-pages/src/pages/settings/providers/speech/mimo-audio-speech.vue` | 44-50 | `ensureProviderConfig()` 在投影里建空对象 |
