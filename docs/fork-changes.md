# 本 fork 相对上游的改动台账

这份文档记录「清锡医疗」分支相对 `moeru-ai/airi` 上游的全部偏离。
目的只有一个：合上游时按这份清单逐条处理，而不是翻 `git diff` 猜意图。

维护规则：

- 每个条目写清 **改了什么、为什么、什么时候可以撤回**。
- 新增偏离时必须在这里加一条，否则下次合上游必然漏。
- 「上线前必须改回」一节的条目，公开发布前逐条确认。

采集时间：2026-10-19。上游基线：`2c1e223c8 release: v0.12.0-beta.5`。

## 1. 主题总览

| 主题 | 冲突面 | 撤回难度 |
| --- | --- | --- |
| A. 认证与账号 | `server/apps/auth` 4 个文件 | 低 |
| B. 语言与界面 | `stage-web`、`ui-server-auth`、`stage-pages` 共 7 个文件 | 低 |
| C. 品牌与产品化 | `stage-web` 入口与页面、`stage-ui` 认证组件 | 中 |
| D. 开发体验 | Vite watcher 配置 | 低 |
| E. 本 fork 新增（不在上游） | 未跟踪文件 | 无冲突 |

## 2. A. 认证与账号

全部在 `server/apps/auth`。这一块是「用邮箱密码登录，不要社交登录」的直接后果。

### A1. 社交 provider 改为可选

- 文件：`src/env.ts`
- 改动：`AUTH_GOOGLE_CLIENT_ID/SECRET`、`AUTH_GITHUB_CLIENT_ID/SECRET` 从 `nonEmpty` 必需改为 `optional(string(), '')`。
- 原因：原 schema 缺这四个值就 `exit(1)`。本部署只服务邮箱密码。
- 注意：`auth.ts` 的 `socialProviders` 仍注册空 clientId 的 google/github，better-auth 只警告不报错：
  `WARN [Better Auth]: Social provider google is missing clientId or clientSecret`
- 撤回条件：需要社交登录时，把四个值设回必需并填入真实凭证。

### A2. 关闭邮箱验证

- 文件：`src/auth.ts`，`emailAndPassword.requireEmailVerification`
- 改动：`true` → `false`
- 原因：本部署没有邮件服务（`RESEND_API_KEY` 为空）。开着验证时注册能成功，但之后所有登录都返回
  `403 EMAIL_NOT_VERIFIED`，账号实际上无法使用。
- **上线前必须改回**：配好 Resend 后恢复 `true`。
- 副作用：任何人都可以用任意邮箱注册，不验证所有权。替代方案是后续的手机号验证。

### A3. 放宽密码长度

- 文件：`src/auth.ts`，`emailAndPassword.minPasswordLength`
- 改动：新增 `minPasswordLength: 6`（better-auth 默认 8）
- 原因：内部测试统一用 `123456`，默认值会返回 `400 PASSWORD_TOO_SHORT`。
- **上线前必须改回**：至少 8。

### A4. 限流可配置

- 文件：`src/env.ts`（新增两个变量）、`src/routes.ts`（改为读 env）、`src/tests/rate-limit.test.ts`（fixture 补字段）
- 改动：`/api/auth/*` 的 `max: 20 / windowSec: 60` 硬编码改为读 `AUTH_RATE_LIMIT_MAX` / `AUTH_RATE_LIMIT_WINDOW_SEC`，默认值保持 20/60。
- 原因：本地反复测试登录会撞 429。本地 `.env.local` 设 `AUTH_RATE_LIMIT_MAX=1000`，生产用默认值。
- 撤回条件：不需要可配置时可以改回常量。

## 3. B. 语言与界面

产品只服务简体中文。实现方式是**绕过** `packages/stage-ui` 的语言兜底，而不是修改它。

### B1. 主应用强制中文

- 文件：`apps/stage-web/index.html`
- 改动：
  1. `<html lang="en">` → `lang="zh-Hans"`
  2. 新增内联脚本，在任何模块加载前执行 `localStorage.setItem('settings/language', 'zh-Hans')`
- 原因：真正的语言决定权在 `packages/stage-ui/src/stores/settings/general.ts` 的 `onMounted`，
  它用 `navigator.language` 覆盖 i18n 的初始值。内联脚本先写 storage，store 读到就是中文。
- 为什么不改 `general.ts`：它是三个 stage 应用共享的，且有一个上游测试
  `issue #1658: falls back to navigator.language when localStorage is empty` 依赖该行为。

### B2. 主应用 i18n 兜底

- 文件：`apps/stage-web/src/modules/i18n.ts`
- 改动：`getLocale()` 的兜底 `navigator.language || 'en'` → `|| 'zh-Hans'`
- 原因：B1 的内联脚本写入前，模块可能已经求值。这行保证那个窗口期也是中文，同时作为
  storage 被禁用（隐私模式）时的兜底。

### B3. 登录界面强制中文

- 文件：`apps/ui-server-auth/src/modules/i18n.ts`
- 改动：删除 `localStorage` / `navigator.language` 查找，语言固定为 `zh-Hans`
- 原因：登录界面在独立 origin（5173），读不到主应用（5180）的语言设置；且部署只服务一种语言，
  不应由访问者的浏览器决定。
- 配套：`apps/ui-server-auth/index.html` 的 `lang` 同步改为 `zh-Hans`。

### B4. 设置页移除语言选择器

- 文件：`packages/stage-pages/src/components/settings-general-fields.vue`
- 改动：删除语言 `FieldCombobox`、`languages` computed、`all` 导入
- 原因：B1 每次加载都强制中文，选择器选了会在刷新后失效，留着是坏掉的 UI。
- 注意：该组件与 `stage-tamagotchi` 共用，桌面端的语言选择器也一并消失。
- 撤回条件：恢复多语言部署时把 combobox 加回来。

### B5. 登录页去掉条款跳转

- 文件：`apps/ui-server-auth/src/pages/sign-in.vue`
- 改动：页脚两个 `<a href="https://airi.moeru.ai/docs/en/...">` 改为纯文本 `<span>`；同时隐藏「忘记密码」链接
- 原因：条款/隐私必须指向本产品自己的页面，而指向 AIRI 官方文档（英文）是错的。
  「忘记密码」依赖 Resend，当前必然 503。
- 撤回条件：有自己的条款/隐私页、并配好 Resend 之后恢复。

## 4. C. 品牌与产品化

| 文件 | 改动 |
| --- | --- |
| `apps/stage-web/index.html` | title / description / OG / Twitter 改为「清锡医疗」 |
| `apps/stage-web/src/pages/nurse.vue` | 新增护士页：只保留对话与语音，刻意去掉 header、设置入口 |
| `apps/stage-web/src/modules/defaults.ts` | 构建期下发 provider / 角色卡 / 显示模型 / 用户画像默认值 |
| `apps/stage-web/src/modules/display-model-presets.ts` | 注册部署自带的 Live2D 模型 |
| `apps/stage-web/deploy/` | nginx + Caddy + compose 静态部署方案 |
| `packages/stage-ui/src/stores/display-models.ts` | 新增 `registerDisplayModelPreset()` 扩展点 |
| `packages/stage-ui/src/components/auth/providers.ts` | OAuth 按钮列表清空（本部署无社交登录） |

`providers.ts` 清空影响三处 UI：登录页、账户设置、个人资料页。撤回条件：启用任一社交登录。

## 5. D. 开发体验

| 文件 | 改动 | 原因 |
| --- | --- | --- |
| `apps/stage-web/vite.config.ts` | `server.watch.ignored` 忽略 `**/.*.tmpdir` | 写文件的工具用「临时目录 + 改名」，Windows 上删除临时文件会抛 `EBUSY` 并让 Vite 退出 |
| `apps/ui-server-auth/vite.config.ts` | 同上 | 同一个原因，2026-10-19 实测崩溃过一次 |

## 6. E. 本 fork 新增（上游无对应文件）

这些不构成合并冲突，但换机器时要知道它们存在。

| 路径 | 内容 |
| --- | --- |
| `apps/stage-web/src/modules/defaults.ts` | 构建期默认值下发（见 C） |
| `apps/stage-web/src/pages/nurse.vue` | 护士页 |
| `apps/stage-web/src/assets/airi-cards/xiaoqing.json` | 小清角色卡 |
| `apps/stage-web/public/models/live2d/chun-nurse-white.zip` | 护士 Live2D 模型（6.4 MB） |
| `apps/stage-web/deploy/` | 部署方案 |
| `medical-kb/` | 知识库服务（Python） |
| `docs/scripts/sync-gitee.ps1` + `.md` | 同步已提交内容到 Gitee |
| `docs/scripts/create-local-account.ps1` | 本地建验证过的账号 |
| `docs/design-harness/`、`docs/canvas.html`、`.design-harness/` | 并行工作的设计文档 |

## 7. 上线前必须改回的两处

| 位置 | 现在 | 改成 |
| --- | --- | --- |
| `server/apps/auth/src/auth.ts` | `requireEmailVerification: false` | `true`（同时配 `RESEND_API_KEY`） |
| `server/apps/auth/src/auth.ts` | `minPasswordLength: 6` | 至少 `8` |

## 8. 已知风险：密钥落在浏览器

`apps/stage-web/src/modules/defaults.ts` 把 `.env.local` 里的 provider 密钥写进每个访客的
`localStorage`（`settings/providers/configured.<id>.config.apiKey`），而 `VITE_` 前缀的值在构建时
还会被内联进 `assets/*.js`。

已实测确认（2026-10-19）：

- `apps/stage-web/dist/assets/index-*.js` 含 DeepSeek 与 MiMo 两把 key
- 实际打包的 `airi-web-dist.zip` 中 `assets/index-Q2oJMGyA.js` 同样含这两把
- 知识库 key 未被内联（构建时已剥离）

当前决定：**内部测试阶段暂不处理**，继续使用现有 key。

相关约束：

- `dist/` 与 `airi-web-dist.zip` 不得外发。`.gitignore` 已用 `/*.zip` 挡住 zip。
- 站点一旦对外公开，必须在控制台重置这两把 key。
- 根治方案见第 9 节第 4 步。

### 轮换 key 后怎么让老浏览器拿到新值

`writeProviderRecord` 的规则是「记录已存在就不动」，所以换 key 之后，所有打开过应用的浏览器
仍然持有旧 key，聊天会以一条无法解释的上游 401 失败。

为此 `defaults.ts` 提供一个**显式的一次性清理**：

| 项 | 值 |
| --- | --- |
| 环境变量 | `VITE_PROVIDER_PURGE_VERSION`（空 = 不清） |
| 浏览器标记 | `settings/defaults/provider-purge` |
| 行为 | 值变化时删除 `settings/providers/configured` + `settings/providers/added`，随后 `ensureDeploymentProviders()` 用本版构建的凭证重建 |
| 代价 | 同时丢弃访客自己添加的 provider |

故意**不**绑定 `VITE_DEFAULT_CONFIG_VERSION`：绑它等于每次发版都清理，会毁掉访客自己填的 key，
而且公开构建剥掉密钥时会让所有人没有可用 provider。

顺序要求：服务端 `user_provider_configs` 必须先清空，否则第 6 步的同步会在登录后把旧 key 推回来。


## 9. 待决策与分步计划

### 待决策

| 编号 | 问题 | 影响 |
| --- | --- | --- |
| D1 | 患者要登录才能聊天吗 | 不要 → 配置无法跟账号走，只能留在浏览器 |
| D2 | 给用户 Flux 额度吗 | 不给 → 用不了官方网关（`/api/v1/openai` 余额不足返回 402） |
| D3 | provider 用谁的 key | 共用部署的 → 必须走服务端网关 |

### 分步计划

| 步 | 内容 | 依赖 | 状态 |
| --- | --- | --- | --- |
| 1 | 确认构建产物是否泄漏密钥 | 无 | **已完成**：DeepSeek + MiMo 已泄漏，决定暂不处理 |
| 2 | 本文档 | 无 | **已完成** |
| 3 | 模块选择改为用户永久保留 + 重置入口 | 无 | **已完成** |
| 4 | 拆掉 `defaults.ts` 的密钥层 | D3 | **后端已完成**：网关实测返回真实回复；前端切换待做 |
| 5 | 网关免计费开关 | D2 / D3 | **已完成（仅对话）**：TTS 仍保留计费门禁 |
| 6 | provider 配置上云（接 `/api/v1/providers`） | D1 | **已完成**：实测登录首迁移，服务端 3 条含新 key |
| 7 | 端到端回归 | 全部 | 待做 |

### 第 6 步的背景

后端**已经具备**完整的 provider 配置 CRUD，前端零调用：

- `GET|POST /api/v1/providers`、`GET|PATCH|DELETE /api/v1/providers/:id`（`authGuard` + 归属校验）
- 表 `user_provider_configs`：`ownerId`、`definitionId`、`name`、`config`(jsonb)、`validated`、`deletedAt`
- `config` 是明文 JSON，**不加密**

所以「配置上云」的工作量主要在前端。

## 10. 其它已知不一致

- **护士页的 About 按钮**：桌面端没有（`InteractiveArea` 不含 `ActionAbout`），移动端有
  （`MobileInteractiveArea` 里无条件渲染，不受 `hide-settings` 控制）。需要统一。
- **About 弹窗内容仍是 AIRI 品牌**：标题默认 `Project` + `AIRI`，链接指向 AIRI 官网 / 文档 / GitHub，
  且「Application build information」等 6 个标签是硬编码英文。

## 11. 模块选择的归属（2026-10-19 调整）

`defaults.ts` 原来对 6 个键用 `force: true`，每次 `VITE_DEFAULT_CONFIG_VERSION` 变化都覆盖用户选择。
现在改为：**用户的选择永久保留**，只提供显式的「恢复部署默认值」入口。

| 键 | 归属 | 依据 |
| --- | --- | --- |
| `settings/consciousness/active-provider` | 访客 | 用户可以在多个对话来源之间切换 |
| `settings/consciousness/active-model` | 访客 | 同上 |
| `settings/speech/active-provider` | 访客 | 同上 |
| `settings/speech/active-model` | 访客 | 同上 |
| `settings/speech/voice` | 访客 | 同上 |
| `settings/stage/model` | **部署** | 显示模型就是产品形象，换掉就不是这个产品了 |

相关文件：

| 文件 | 改动 |
| --- | --- |
| `packages/stage-ui/src/libs/deployment-default-keys.ts` | **新增**。5 个访客归属按键的单一来源，因为每个键都是 stage-ui 某个 store 的持久化键 |
| `apps/stage-web/src/modules/defaults.ts` | 5 处选择写入去掉 `force`；改为从上面的模块导入键名；显示模型继续 `force` |
| `packages/stage-ui/src/composables/use-data-maintenance.ts` | `restoreBuildDefaults()` 现在同时删除这 5 个键。**这是必须的**：构建默认值只在键为空时写入，不同步删掉，恢复按钮就失效 |

恢复入口在设置 → 数据 → 危险操作 → 「恢复部署默认值」（`danger-section.vue`），
它会清键并自动 reload，下次启动重新写入部署默认值。

## 12. provider 配置上云（第 6 步）

后端本来就有完整 CRUD（`/api/v1/providers`，`authGuard` + 归属校验 + 软删除，表
`user_provider_configs`），前端也有服务层（`inferenceServiceProvidersService`）。缺的是连接。

| 环节 | 状态 |
| --- | --- |
| 服务层 GET/POST/PATCH/DELETE | 已具备（上游） |
| 写路径（加/删/改 provider 调 API，失败降级本地） | 已具备（上游） |
| **读路径 + 首次迁移** | **本次新增** |
| 未登录时的写入 | 仍会尝试 API 并 401，有意保留（去掉守卫会破坏 2 个上游测试） |

`config.ts` 新增的行为：

- `authStore.onAuthenticated()` → `fetchProviders()`（同步 action，follower 窗口走 leader）
- 服务端**有**记录 → 服务端权威，合并进本地
- 服务端**空** → 视为该账号首次登录，把本地已有的 provider 逐条 POST 上去
- `authStore.onLogout()` → `resetProviders()`，清本地。**不清的话下一个账号会继承并上传上一个账号的 provider 和 key**

已验证（2026-10-19）：`POST /api/v1/providers` 返回 201，`GET` 能读回，数据库落行；
`config.test.ts` 6 个测试全过。

端到端实测：浏览器登录后 `user_provider_configs` 出现 3 条记录，`deepseek` 的
`config.apiKey` 是轮换后的新值 —— 说明「登录 → 服务端为空 → 上传本地」这条迁移路径成立。

**注意：上云不等于密钥离开浏览器。** `defaults.ts` 仍然把 key 写进 localStorage，
浏览器依旧持有明文。要让 key 不出前端，必须让调用走服务端网关（第 4、5 步）。

## 13. 网关免计费（第 5 步）

本部署免费提供对话，`user_flux` 永远是 0，所以网关默认的计费路径会对每个请求返回 402。

| 文件 | 改动 |
| --- | --- |
| `server/apps/api/src/libs/env.ts` | 新增 `OPENAI_GATEWAY_BILLING_MODE`：`enforce`（默认）/ `off` |
| `server/apps/api/src/routes/openai/v1/types.ts` | `V1RouteDeps` 增加 `billingEnabled` |
| `server/apps/api/src/routes/openai/v1/middlewares/billing.ts` | `billingEnabled: false` 时六个函数全部空转（不查余额、不扣账、价格恒为 0） |
| `server/apps/api/src/routes/openai/v1/index.ts` | 关闭计费时跳过 chat 路由的 `FLUX_PER_REQUEST` 守卫 |
| `server/apps/api/src/app.ts` | 从 env 传入 |
| `server/apps/api/src/routes/openai/v1/route.test.ts` | 补 `billingEnabled: true`，保持上游断言 |

**TTS 未覆盖**：`/api/v1/audio/speech` 的计费在 `createOpenAiSpeechService` 内部，仍在查余额，
所以那条路由的 `FLUX_PER_1K_CHARS_TTS` 守卫保留。需要免费 TTS 时再改那个服务。

已验证（2026-10-19）：`route.test.ts` 63 个测试全过；`typecheck` + `lint` 通过；
实测 `POST /api/v1/openai/chat/completions` 的响应从「服务不可用」变为
`CAPABILITY_ALIAS_NOT_FOUND`，说明计费门禁已经让开，卡点后移到了模型别名。

## 14. 网关的配置链条（第 4 步的现状）

要让浏览器真正走网关，需要三层配置，**目前三层都缺**，且没有管理接口：

| 层 | 存在哪 | 现状 |
| --- | --- | --- |
| 客户端 model 名 | 前端请求体 | 必须填**别名 id**，即 `auto`（`provider-catalog/index.ts` 的 `DEFAULT_ALIAS_ID`） |
| capability alias | 表 `capability_aliases` + `capability_alias_routes` | **空**。服务层有 `syncAliasesFromRouterConfig({ surface, modelIds })`，但没有任何启动路径调用它 |
| 上游路由 | configKV 的 `LLM_ROUTER_CONFIG` | **未设置**。上游 key 需用 `LLM_ROUTER_MASTER_KEY` 做 envelope 加密，不能手写 |

调用链：客户端 `model: auto` → 别名 `auto` → 路由到 `routerModelId`（如 `deepseek-flash`）
→ `LLM_ROUTER_CONFIG.llm.models['deepseek-flash']` → 上游。

所以第 4 步的产物是一个**播种脚本**：加密 key、写 `LLM_ROUTER_CONFIG`、建别名与路由。

### 播种脚本

`server/apps/api/src/scripts/seed-gateway.ts`，入口 `pnpm -F @proj-airi/api-server run seed:gateway`。

需要 `.env.local` 里的 `DEEPSEEK_API_KEY`（和可选的 `DEEPSEEK_BASE_URL`），用
`LLM_ROUTER_MASTER_KEY` 加密后只写密文。幂等：每次重写 `LLM_ROUTER_CONFIG`，
别名与路由只在缺失时插入，最后删掉 Redis 缓存键。

实测结果（2026-10-19）：

- `config_kv` 出现 `LLM_ROUTER_CONFIG`，上游 key 是 `v1.…` 密文，不是明文
- `capability_aliases` 一行：`surface=llm`、`alias_id=auto`
- `capability_alias_routes` 一行：`auto → deepseek-flash`（pool `primary`）
- `POST /api/v1/openai/chat/completions` 带 `model: "auto"` 返回 **HTTP 200** 和真实的
  DeepSeek 中文回复，`usage` 正常记账（`prompt_tokens: 38`）

### 尚未完成：前端切换

前端默认 `provider` 还是 `deepseek`（浏览器直连、持有 key）。要切成 `official`
（走 `/api/v1/openai`）并注意两点：

1. 模型名必须填别名 `auto`，不是 `deepseek-flash`
2. **网关挂在 `authGuard` 后面，匿名调用返回 401** —— 也就是说走网关就等于要求登录。
   这是 D1 的答案被技术约束锁定的地方，需要产品层面确认。

### 前端切换前必须决定

| 选项 | 含义 |
| --- | --- |
| 要求登录 | 患者先注册再对话。key 彻底不进浏览器，最干净 |
| 网关放开匿名 | 需要对匿名调用加 IP 级限流，否则额度会被刷 |
| 暂不切换 | 保持浏览器直连，key 继续留在前端（现状） |

**决定（2026-10-19）：选「暂不切换」。**

因此当前状态是：

- 网关在服务端**已配置可用**（实测返回真实回复），但**前端不调用它**
- 浏览器仍然直连 DeepSeek 并持有明文 key —— **第 4 步的安全目标没有达成**
- 服务端持有同一把 key 的 envelope 密文，与浏览器那份无关

要恢复这一步，只需把 `defaults.ts` 的聊天默认值改成 `official` + 模型 `auto`，
前提是先解决网关的 `authGuard`（见上表）。

### ⚠️ 选 C 之后遗留的风险

`OPENAI_GATEWAY_BILLING_MODE=off` 仍然生效，而网关挂在 `authGuard` 后面。这意味着
**任何注册用户都可以直接调用 `/api/v1/openai/chat/completions`（`model: auto`）免费消耗
部署的 DeepSeek 额度**，不需要用前端。而本部署的注册门槛是零（邮箱验证已关闭）。

网关未使用时，安全的做法是把这一行删掉或改成 `enforce`，让该端点对所有调用返回 402。

## 15. 登录后白屏的修复（2026-10-20）

现象：在 `ui-server-auth` 里登录成功后跳到 `/ui/`，页面全白。

根因在 `unplugin-vue-router@0.19.2`：它生成路由时只输出白名单字段
（`path` / `name` / `component` / `props` / `alias` / `children` / `meta`，见其 dist 里的
`generateRouteRecords`），**`<route>` 块里的 `redirect` 会被静默丢弃**。
于是 `pages/index.vue` 里那句 `<route lang="yaml">redirect: /profile</route>` 从来没有生效过，
`/ui/` 渲染的是空的 `<div />`，也就是白屏。

| 文件 | 改动 |
| --- | --- |
| `apps/ui-server-auth/src/main.ts` | 新增一条 `beforeEach` 守卫：`to.path === '/'` → `{ path: '/profile', replace: true }`，并附 `// NOTICE:` 说明移除条件 |
| `apps/ui-server-auth/src/pages/index.vue` | 删掉无效的 `redirect` 代码块，注释改为说明重定向在 `main.ts` |

实测（Playwright + 系统浏览器）：`/ui/` → `/ui/profile` →（无会话）`/ui/sign-in?redirect=/profile`；
用 `nurse@example.com` 登录后落在 `/ui/profile`，账号资料页正常渲染，控制台无报错。

**移除条件**：等 unplugin-vue-router 支持从 `<route>` 块输出 `redirect` 后，把守卫移回 `index.vue`。

### 顺带发现的小问题

登录后的资料页是**中英混排**：标签是英文（`Account profile`、`Email status`），
日期却是中文（`2026年10月19日`）。原因是界面语言被强制成 `zh-Hans`，而 `ui-server-auth`
的这些标签没有中文翻译。属于观感问题，功能正常。

## 16. 对话历史（云端）

**结论：上游已实现，不需要新写。** 之前看起来「没记忆」，是因为登录方式用错了。

### 关键前提：必须从主应用登录

| 登录位置 | 效果 |
| --- | --- |
| `localhost:5173/ui/` 账号界面 | 只种下 **cookie**。主应用的 `stores/auth.ts` 读的是本地保存的 **access token**，所以主应用仍是匿名 |
| `localhost:5180/settings/account` 点「登录」 | 走完整 OIDC：authorize → 账号界面 → `/auth/callback?code=…` → 换 token。主应用才真正登录 |

匿名时 `getCurrentUserId()` 返回 `'local'`，`reconcileCloudSessions` 和 `ensureCloudWsClient`
都会直接 return（控制台只有一行 `[chat-sync] WS skipped: anonymous user`），所以不同步也不报错。

### 链路

| 内容 | 通道 |
| --- | --- |
| 会话（`chats` / `chat_members`） | REST `/api/v1/chats` |
| 消息 | WebSocket `/ws/v2/chat`（Eventa RPC：`sendMessages` / `pullMessages`） |

只同步 `user` 和 `assistant` 的文本；`system`、`tool`、`error` 按 `isCloudSyncableMessage` 丢弃。

### 实测（2026-10-20，Playwright + 系统浏览器）

1. 从主应用登录 → `[chat-sync] creating WS client → http://localhost:6112`
2. 发一条 `记住这串数字：7391` → 模型回复
3. 数据库：`messages` 出现 2 行（`user` / `assistant`），`/ws/v2/chat` 帧数 17 发 19 收
4. **换干净浏览器登录** → 打开「对话」抽屉 → `记住这串数字：7391`（带 `CLOUD` 标记）能拉回来

### 本次改动：抽屉不再列空对话

每次启动都会新建一个会话并同步到云端，于是抽屉里堆满同名的「新建对话」（实测 6 行里 5 行是空的）。

| 文件 | 改动 |
| --- | --- |
| `packages/stage-ui/src/components/scenarios/chat/components/sessions-drawer.vue` | 新增 `contentTextOf` / `hasContent`；`rows` 只列**有内容**的会话，但**当前会话始终保留** |

实测 6 行 → 2 行（真实对话 + 当前新建的空会话）。

### 遗留

- **服务端仍会堆积空会话**：只在抽屉隐藏，`chats` 表照样一行一个。
  根治要改成「首条消息发出时才 `POST /api/v1/chats`」。
- **匿名时静默不同步**：没有「登录后可跨设备同步」的提示，用户会以为历史功能坏了。

## 17. 手机号登录（2026-10-20）

需求：用手机号注册和登录，作为默认方式；**暂不做短信验证**。

### 为什么不用 Better Auth 的 `phone-number` 插件

better-auth 1.4.22 自带该插件，它的 `signIn.phoneNumber` 支持密码模式，但**注册必须走
`send-otp` + `verify`**（账号在 verify 那一步才创建）。不上短信就走不通这条注册路径。

### 采用的方案：手机号映射成账号标识

`user.email` 在 `server/packages/auth-shared` 里是 `NOT NULL UNIQUE`，而 Better Auth 的密码
账号以邮箱为标识。所以手机号存成 `<号码>@phone.local`（`.local` 是保留 TLD，永远收不到邮件，
误发的重置邮件会明显失败而不是进真实信箱）。

| 文件 | 改动 |
| --- | --- |
| `apps/ui-server-auth/src/modules/phone-account.ts` | **新增**。`isPhoneIdentifier` / `toAccountEmail` / `toDisplayIdentifier` / `defaultAccountName`，附 `// NOTICE:` 说明移除条件 |
| `apps/ui-server-auth/src/modules/phone-account.test.ts` | **新增**，10 个用例覆盖映射与反向显示 |
| `apps/ui-server-auth/src/pages/sign-in.vue` | 标识字段 `type="email"` → `type="text"`（否则浏览器校验拦住手机号）；`checkEmail` / `signInWithEmail` / `signUpWithEmail` 都先过 `toAccountEmail`；昵称默认取手机号 |
| `apps/ui-server-auth/src/pages/profile.vue` | 资料页用 `toDisplayIdentifier` 显示，不再露出 `@phone.local` |

**零服务端改动** —— 没有动 schema、没有动 auth 配置、没有启用新插件。

实测（Playwright + 系统浏览器）：输 `13900002222` → 「创建账户 / 我们将为 13900002222 创建一个新账户」
→ 设密码 → 落在资料页显示 `13900002222`；换干净上下文用手机号+密码重登成功；数据库
`email = 13900002222@phone.local`、`name = 13900002222`。

**移除条件**：接短信后改用 `phone-number` 插件，把号码存进 `user.phone_number`，
并迁移 `email like '%@phone.local'` 的账号。

### 顺带修掉：登录界面一直是英文的

`packages/i18n/src/locales/zh-Hans/` 下有 `server/auth.yaml`，但 `zh-Hans/index.ts`
**没有 `import server from './server'`** —— 整个 `server.*` 命名空间从未进入中文包，
所有键都回退到英文。`en` 之外的其他 7 个语种同样缺少 `server/index.ts`（上游疏漏）。

| 文件 | 改动 |
| --- | --- |
| `packages/i18n/src/locales/zh-Hans/server/index.ts` | **新增** `import auth from './auth.yaml'` |
| `packages/i18n/src/locales/zh-Hans/index.ts` | 增加 `import server from './server'` 与 `server,` |
| `zh-Hans` / `en` 的 `server/auth.yaml` | 文案改为手机号优先：`手机号或邮箱`、`请输入手机号（也可填邮箱）`、`使用其他账号`、资料页 `手机号或邮箱` / `验证状态` |

其他语种没有补，按仓库规则由 Crowdin 维护。








