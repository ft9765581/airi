# 项目上下文（每个会话必读）

本仓库是「清锡医疗」对 `moeru-ai/airi` 的 fork，产品是产后访视护士「小清」。
这份文件记录**跨会话必须知道的事**：当前阶段、已接受的取舍、部署事实、默认配置、已知坑。
上游与本 fork 的逐条差异见 `docs/fork-changes.md`（那份是"改了什么、为什么、怎么撤回"）。

## 1. 当前阶段：小范围试运行

- 只关注**功能可用性**。性能优化、重构、完善度都不优先。
- **API Key 暴露暂不处理，这是有意接受的取舍，不要反复提示或自行改造**：
  - DeepSeek / 小米语音的 Key 打进前端 bundle（任何人可读）
  - 知识库连接的 Key 明文存浏览器 localStorage
  - 只在小范围试用，等要公开推的时候再统一收回服务端（方案见第 5 节）
- **不要主动打包**：只有明确说「打包」时才构建并产出 zip。改了代码就停下来说改了什么。
- 不要动 `apps/stage-web/.env.local` 里与知识库无关的内容；那份文件被 git 忽略。

## 2. 部署事实

| 项 | 值 |
| --- | --- |
| 线上站点 | `https://airi.bestmings.com`（宝塔，"HTML 项目"式纯静态托管） |
| 前端产物 | 本地构建 → 上传 `dist`（服务器 Node 太旧，不在服务器上构建） |
| LLM 端点 | `https://airi.bestmings.com/v1` → nginx 反代 → `124.222.129.13:39111`（vLLM，`Qwen3-8B`） |
| 语音 | 直连小米 `https://api.xiaomimimo.com/v1/`（`mimo-v2.5-tts` / 冰糖） |
| 知识库 | 不用 Dify，走服务端代理 `POST /api/v1/knowledge-base/retrieval`（`docs/fork-changes.md` 第 18 节） |
| 后端（可选） | 官方 `server/` 那套（db+redis+api+auth），部署包在 `deploy/`；本机 `pnpm dev:backend` |

## 3. 打包给线上时必须设 `VITE_SERVER_URL`

**这是登录能不能用的开关**（已实测，别忘）：

| 位置 | 值 |
| --- | --- |
| 线上构建 | `VITE_SERVER_URL=https://airi.bestmings.com` |
| 本地开发 | `VITE_SERVER_URL=http://localhost:6112`（已在 `.env.local`） |

不设的后果：`SERVER_URL` 回退到上游 `https://api.airi.build` →
点「登录」会走 `api.airi.build/api/auth/oauth2/authorize` → `invalid_redirect` → 最终被弹到
`https://airi.moeru.ai/`。同时聊天云同步、知识库代理（前端按 `SERVER_URL` 判断是否带 JWT）
也都会指向官方服务器。

已验证：本部署后端是好的 —— `https://airi.bestmings.com/api/auth/.well-known/openid-configuration`
返回 200，`oauth2/authorize` 接受 `redirect_uri=https://airi.bestmings.com/auth/callback`，
账号 UI 在 `https://accounts.bestmings.com/ui/`。

打包时其余变量以 `apps/stage-web/.env.local` 的**当前值**为准（DeepSeek Key 会轮换，
不要沿用旧值）；知识库 URL 用代理地址
`https://airi.bestmings.com/api/v1/knowledge-base/retrieval`，Key 留空（在服务端）。

## 4. 默认配置由构建写死（`apps/stage-web/src/modules/defaults.ts`）

`VITE_DEFAULT_CONFIG_VERSION` 一变，就会把下列值**强制写回每个浏览器**：

| 键 | 值 |
| --- | --- |
| 聊天来源 / 模型 | `deepseek` / `deepseek-flash`（`VITE_DEFAULT_DEEPSEEK_MODEL` 决定它是默认） |
| 备用聊天来源 | `openai-compatible` + `https://airi.bestmings.com/v1`（保留可切换） |
| 语音来源 / 模型 / 音色 | `mimo-audio-speech` / `mimo-v2.5-tts` / 冰糖 |
| 形象 | `preset-live2d-chun-nurse`（春 · 护士白裤子版，包在 `apps/stage-web/public/models/live2d/`） |
| 角色卡 | `xiaoqing`（`apps/stage-web/src/assets/airi-cards/xiaoqing.json`） |
| 用户画像 | 空 |
| 舞台缩放 / 位置 | `0.75` / `y=20` |

规则：用户自己改过的值保留；**老构建自己写过的值算"可覆盖"**（`SHIPPED_VALUES` 那几张表），
否则老浏览器永远修不回来。provider 记录缺失时每次启动都会补齐。

## 5. 本地开发

```sh
pnpm -F @proj-airi/stage-web dev -- --port 5180    # 前端（别用 5173/5174，容易和别的项目撞）
pnpm dev:backend                                    # 可选：官方后端（Docker，首次要拉镜像）
```

已知环境坑：

- **Docker 出网走 Clash 代理 `127.0.0.1:1082`**：Clash 没开时所有 `docker pull` 失败（连国内镜像站也走这个代理）。
- 改了 `.env` 后 Vite 会重启；清过 `node_modules/.vite` 后**必须换端口或硬刷**，否则老页面会新旧模块混用（表现为图片裂、列表缺项）。
- 截图类验证别用 Playwright 的 `screenshot()`（会卡在等 web 字体），用 CDP `Page.captureScreenshot`。

## 6. 现在不可用 / 别浪费时间的地方

| 项 | 原因 |
| --- | --- |
| AIRI 官方提供商（`official-provider`） | 需要登录 AIRI 账号；且官方网关对本站域名不放 CORS、返回 401 |
| 登录 / 账号 | OIDC 回调 `redirect_uri` 未注册，跳转会带 `error=invalid_redirect` |
| 聊天云同步 / 角色卡云存 | 依赖登录，未启用（后端有接口，前端没接） |
| MCP | 只有 Electron 主进程跑 stdio，网页版用不了（`MCP tool bridge is not available in this runtime`） |
| "Skill" 功能 | 上游没有这个概念；"能力"= 角色卡提示词 + function calling 工具 |

## 7. 将来要收回 Key 时的方向（现在不做）

一处后端解决三件事：`/v1/chat` 代理（藏 DeepSeek Key）、`/api/v1/knowledge-base/retrieval` 代理
（已有，藏知识库 Key）、`/tools/*` 业务接口（当 function calling 工具给模型，替代 MCP）。
前端把 `VITE_SERVER_URL` / `VITE_DEFAULT_LLM_BASE_URL` / `VITE_KNOWLEDGE_BASE_URL` 指过去即可，前端代码不用改。
