# 知识图谱接入开发文档

标签：维护中 · 开发进度

- 接口文档：《清锡医疗知识库 · 知识图谱检索接口说明》v1.0，2026-10-28
  （文件在仓库外：`E:\workspace\AI-medic\platform\knowledge\知识图谱检索接口说明.docx`）
- 最后更新：2026-10-28（补充未提交代码检查）
- 配套台账：`docs/fork-changes.md` 第 22 节（改了什么、怎么撤回）

## 0. 现状一句话

设置页里能配连接、能测连通。代码写完，**没有部署**。图谱**还没接进聊天**。

## 1. 进度总览

状态说明：

- ✅ 完成：代码在仓库，测试通过
- 🚧 卡住：要等一个决定才能动
- ⬜ 未开始

| 编号 | 事项 | 状态 |
| --- | --- | --- |
| S1 | 接口契约层（浏览器侧） | ✅ |
| S2 | 两条知识连接共用的传输层 | ✅ |
| S3 | 连接数据模型与 store | ✅ |
| S4 | 设置页改成两个 Tab，加图谱面板 | ✅ |
| S5 | 连接测试探针（状态与失败文案） | ✅ |
| S6 | 中英文案 | ✅ |
| S7 | 服务端代理（绕开跨域） | ✅ |
| S8 | 测试（新增 35 项） | ✅ |
| S9 | 改动台账与项目上下文 | ✅ |
| N1 | 代理的登录校验语义 | ✅（本次修复） |
| N2 | 自动下发一条图谱连接 | ✅（本次完成） |
| N3 | 接进医疗对话 | ✅（本次完成） |
| N4 | 部署与线上验收 | ⬜ |
| N5 | 连接随账号同步 | ⬜（可选） |
| N6 | 用 block 号取原文 | ⬜（待服务方确认） |
| N7 | 非法服务地址的错误处理 | ✅（本次检查修复） |
| N8 | 服务端 502 / 503 / 504 的提示文案 | ✅（本次修复） |

已完成 14 项，未开始 3 项（N4 等部署，N5 可选，N6 等服务方）。

第 9 节是逐条复查的记录。复查修了 N1、N7、N8；两条 lint 警告已清，`moeru-lint` 对图谱相关文件现在是 0 警告。N2、N3 也在这一轮做完了。

## 2. 接口契约

全部照接口文档写。没有自己编字段。

| 项 | 值 |
| --- | --- |
| 方法 | `GET` |
| 地址 | `https://knowledge.bestmings.com/api/graph/search` |
| 参数 `q` | 必填，1～2000 字 |
| 参数 `limit` | 可选，默认 8，范围 1～50 |
| 参数 `book_id` | 可选，文档 ID（`Book.id`），不是知识库 ID |
| 鉴权 | 线上 `RAG_API_TOKEN` 为空，不需要 Key。网关另设密钥时读 `X-API-Key` |
| 顶层响应 | `query`、`mode`（`lexical` 或 `hybrid`）、`fallback_reason`、`vector_index`、`embedding_configured`、`embedding_model`、`total`、`results` |
| `results[]` | `source_node_id`、`source_title`、`relation_type`、`target_node_id`、`target_title`、`evidence`、`source_note_path`、`obsidian_url`、`weight`、`keywords`、`properties`、`context_kind` |

文档第六节的三条限制：

1. 只检索**已发布**的图谱。未审核、未发布的候选关系查不到（候选查询是 `/api/graph/candidates`）。
2. 线上 `mode` 是 `lexical`，`vector_index` 是 `not_configured`。按字面命中，没有语义检索。
3. 返回的是**关系**，不是文档分段。分段检索走 `/api/demo/knowledge-bases/{id}/search`；对外 Dify 走 `POST /api/dify/retrieval`。

## 3. 实测记录

用真实接口测过。结论影响实现。

| 检查 | 结果 |
| --- | --- |
| `GET …/api/graph/search?q=发热&limit=2` | `200`。`mode=lexical`、`total=2`、字段与文档一致 |
| `limit=1` 与 `limit=50` | `total` 分别是 1 和 50。**`total` 是本次返回条数，不是全库命中数** |
| 带 `Origin: https://airi.bestmings.com` | 响应头**没有** `access-control-allow-origin`，只有 `access-control-allow-credentials: true`。浏览器直连会被拦 |
| `evidence` 字段实际内容 | 只有定位符，例如 `分段 blk-cd12d10bbca74af47107`。没有原文文字 |

前三条决定了做法：`total` 的文案要写清上限；必须走服务端代理。

## 4. 已完成步骤

### S1 接口契约层

文件：`packages/stage-ui/src/libs/knowledge-graph.ts`

- 发 `GET`，参数是 `q`、`limit`、`book_id`。
- `limit` 不填就不传，让服务用自己的 8。不在客户端放第二个默认值。
- 读 `results[]`，映射成 `KnowledgeGraphRelation`（源实体、关系类型、目标实体、evidence、weight）。
- 读 `total`、`mode`、`fallback_reason`。
- 不读 `vector_index`、`embedding_*`、`obsidian_url`、`keywords`、`properties`、`context_kind`。设置页用不到。
- 探测词是 `发热`，来自文档示例。**不能用 `连接测试`**：接口是字面命中，编的词查不到东西。
- 探测取 5 条。

验收：`packages/stage-ui/src/libs/knowledge-graph.test.ts`，11 项通过。

### S2 共用传输层

文件：`packages/stage-ui/src/libs/external-service.ts`

知识库和图谱要做同样三件事，所以抽出一层：

- 补 URL 的 scheme（`kb.example.com` → `https://kb.example.com`）。
- 拼 query。
- 超时 8 秒。
- **区分“被跨域拦下”和“主机不可达”**：两种失败在浏览器里是同一个错误。这里发第二次 `no-cors` 请求，能通就说明只是跨域规则拦的。
- 目标是本部署 API 时改用 `authedFetch`（带会话 token），并且**不再发连接自己的 Key**。
- 凭据头可选：知识库用 `Authorization: Bearer`，图谱用 `X-API-Key`。

`knowledge-base.ts` 改为调用这一层。行为不变，由 `knowledge-base.test.ts` 的 6 项测试守住。

### S3 连接数据模型与 store

文件：

- `packages/stage-ui/src/stores/settings/knowledge-graph.ts`
- `packages/stage-ui/src/stores/settings/connection-scope.ts`

- 一条连接有：地址、API Key、文档 ID（可选）、名称、启用开关、流程范围。
- 存 `localStorage`，键是 `settings/knowledge-graph/connections`。和知识库列表互不影响。
- `connectionsFor(scope)` 只要求“启用 + 有地址”。文档 ID 可选，不参与过滤。
- `ConnectionScope` 和 `connectionScope()` 从知识库 store 移到 `connection-scope.ts`，两边共用。

验收：`knowledge-graph.test.ts` 6 项通过。

### S4 设置页 Tab

文件：`packages/stage-pages/src/pages/settings/knowledge-base/`

- `index.vue` 用 `SelectTab` 加两个 Tab。原来的知识库内容整体搬到 `components/knowledge-base-connections.vue`。
- 新增 `knowledge-graph-connections.vue`、`-list.vue`、`-item.vue`、`-form.vue`。
- 原来的 `knowledge-base-status-badge.vue` 改名 `connection-status-badge.vue`，两边共用。
- 路由没变，还是 `/settings/knowledge-base`。设置入口还是一个。

### S5 连接测试探针

文件：`.../composables/use-service-probe.ts`

- 两条连接共用一套状态机：`untested`、`testing`、`connected`、`failed`。
- 失败原因只有一份实现：超时 / 被跨域拦下（文案带本页 origin）/ 不可达 / HTTP 400 或 422 / 404 / 401 或 403 / 503（服务端没配好地址）/ 502（服务端连不上服务）/ 504（服务端等超时）/ 服务 `error_code` 1001、1002、2001。
- 图谱没有 `error_code`，所以 2001 那条只有知识库会走到。
- 成功那行由各自提供：知识库报命中条数，图谱报“命中 N 条关系（每次最多取 5 条）+ 检索模式”。

### S6 中英文案

文件：`packages/i18n/src/locales/en/settings.yaml`、`.../zh-Hans/settings.yaml`

新增 `knowledge-base.tabs.*` 和整个 `knowledge-base.graph.*`。旧键不改。其他语种留给 Crowdin。

### S7 服务端代理

为什么要有：知识服务不放跨域头，浏览器直接调一定失败。

| 文件 | 内容 |
| --- | --- |
| `server/apps/api/src/routes/knowledge-graph/index.ts` | `GET /api/v1/knowledge-graph/search`。**不校验登录**，理由写在文件头注释里：上游不需要密钥，这个路由不保护任何秘密，而要求登录会让没有账号的访客完全用不了图谱 |
| `server/apps/api/src/routes/knowledge-graph/schema.ts` | Valibot 校验。`q` 1～2000 字；`limit` 转成数字再判 1～50，`2.5` 和 `abc` 都拒；`limit` 缺省时不补值 |
| `server/apps/api/src/services/domain/knowledge-graph.ts` | 转发、8 秒超时、错误映射（未配置或非法地址 503 / 不可达 502 / 超时 504）、Key 走 `X-API-Key` |
| `server/apps/api/src/libs/env.ts` | 新增 `KNOWLEDGE_GRAPH_URL`、`_API_KEY`、`_TIMEOUT_MS` |
| `server/apps/api/src/app.ts` | 挂载 `/api/v1/knowledge-graph` |
| `deploy/docker-compose.yaml`、`deploy/.env.example` | 把三个变量传进 `api` 容器。**漏了这一步，`.env` 里写了也没用** |
| `packages/stage-ui/src/libs/server.ts` | 新增 `KNOWLEDGE_GRAPH_SEARCH_PATH` |
| `packages/stage-pages/.../defaults.ts` | 默认地址三级取：`VITE_KNOWLEDGE_GRAPH_URL` → 本部署代理 → 服务直连地址 |

上游 body 原样透传。前端已经会解释响应，服务端再翻译就是两套词汇。

验收：`server/apps/api/src/routes/knowledge-graph/route.test.ts`，11 项通过。

### S8 测试

| 位置 | 项数 | 内容 |
| --- | --- | --- |
| `packages/stage-ui/src/libs/knowledge-graph.test.ts` | 11 | GET 与参数、`X-API-Key`、关系解析、`total`、404、`no-cors` 判定 |
| `packages/stage-ui/src/libs/knowledge-base.test.ts` | 6 | 守住 S2 重构前的知识库行为 |
| `packages/stage-ui/src/stores/settings/knowledge-graph.test.ts` | 6 | 流程范围、停用、缺地址、无文档 ID、与知识库列表隔离 |
| `server/apps/api/src/routes/knowledge-graph/route.test.ts` | 11 | 匿名可访问、转发、`book_id`、`limit` 边界、503、502、上游状态透传 |

### S9 台账

- `docs/fork-changes.md` 第 22 节：为什么这么改、文件表、行为、遗留、实测。
- `docs/project-context.md`：部署表加一行图谱。

### N2 自动下发一条图谱连接 ✅

问题：原来要患者自己去设置页添加。知识库当初做了自动下发，图谱没做。功能做了但没人会配。

做法：`apps/stage-web/src/modules/defaults.ts` 新增 `ensureMedicalKnowledgeGraph()`，和 `ensureMedicalKnowledgeBase()` 并排，每次启动都跑。

- 地址三级取：`VITE_KNOWLEDGE_GRAPH_URL` → 本部署 API（`VITE_SERVER_URL` + `/api/v1/knowledge-graph/search`）→ 都没有就什么都不写。
- `VITE_KNOWLEDGE_GRAPH_BOOK_ID` 有值才写 `bookId`。空值不写，让服务检索全部已发布图谱。
- 名字写死「妇幼导诊图谱」，`scope: 'medical'`，`enabled: true`，`apiKey: ''`（线上不需要，也不该把 Key 打进浏览器）。
- 记住写过的组合（`settings/defaults/medical-knowledge-graph`）：被访客删掉的不再加回来，换了地址的会再加一条。

验收：`apps/stage-web/src/modules/defaults.test.ts` 新增 5 项通过。

### N3 接进医疗对话 ✅

问题：原来图谱只在设置页能测，聊天时小清不会去查。

做法：

| 文件 | 内容 |
| --- | --- |
| `packages/stage-ui/src/stores/chat/context-providers/knowledge-graph.ts` | **新增**：`retrieveKnowledgeGraphContext(query, scope)`。读该流程的连接，并发查询，按「源实体 + 关系类型 + 目标实体」去重，最多 5 条、1200 字，渲染成 `1. [图谱名] 仅有经期发热 —DERIVED_FROM→ 临床诊疗指南-妇产科学分册` |
| `packages/stage-ui/src/stores/chat/context-providers/medical-references.ts` | **新增**：`retrieveMedicalReferenceContext(query)` 把知识库段落和图谱关系合成**一条**上下文消息，`contextId` 是 `system:medical-reference` |
| `packages/stage-ui/src/stores/chat.ts` | 医疗轮次的 `retrieveContext` 换成上面这条；常规聊天的 provider 列表加上 `createKnowledgeGraphContext` |

几个决定：

- **医疗轮次不能用 provider**：轮次带 `isolate: true`，会跳过所有已注册的 provider。所以走 `libs/intent/turn.ts` 的 `retrieveContext`，这个坑在第 21 节踩过。
- **两个来源合成一条消息**：prompt 里只多一个「引用数据」块，而不是两个各说各话的块。
- **两个来源各自失败**：用 `Promise.allSettled`，图谱挂了不影响段落，反之也一样。`turn.ts` 本身也包了 try/catch，检索整体失败只丢参考。
- **不写原文**：`evidence` 只有 `分段 blk-…` 定位符（见第 3 节），进 prompt 会让模型以为手里有原句。所以只写关系，原文那件事留给 N6。
- **常规聊天也接**：连接上有流程开关，用户勾了「常规聊天」却什么都不发生才是 bug。默认下发的连接是 `medical`，所以小闲聊不会多发请求。

验收：`knowledge-graph.test.ts` 8 项、`medical-references.test.ts` 4 项通过。

## 5. 未完成步骤

N1 已经修了，记在第 9 节。N2、N3 已经做完，写在上面第 4 节。这一节只剩真正还没做的。

### N4 部署与线上验收 ⬜（等部署方）

1. 服务器拉代码。
2. `deploy/.env` 加一行 `KNOWLEDGE_GRAPH_URL=https://knowledge.bestmings.com/api/graph/search`。
3. `docker compose build api && docker compose up -d api`。只重建 `api`，数据库和登录不动。
4. 验收命令：匿名路由不再返回 401。配置正确时预期返回 200；未配置图谱服务时返回 503；上游不可达或超时时分别返回 502 或 504：

   ```sh
   curl -s -o /dev/null -w "%{http_code}\n" \
     "https://airi.bestmings.com/api/v1/knowledge-graph/search?q=发热"
   ```

5. 页面验收：设置页 → 知识图谱 → 添加（地址用默认值）→ 保存 → 测试。期望看到 `已连接 · HTTP 200 · N 毫秒 · 命中 5 条关系（每次最多取 5 条）· 检索模式：lexical`。

### N5 连接随账号同步 ⬜（可选）

知识库连接走 `account-settings` 那套上云。图谱连接目前只在本机浏览器。

### N6 用 block 号取原文 ⬜（待服务方确认）

线上 `evidence` 只有 `分段 blk-…`，没有原文文字。文档说“多为「分段 + 文本」”。有两种可能：服务有开关没开，或者文档写宽了。

要用原句引用，得拿 `blk-…` 去别的接口取文本。需要服务方确认那个接口认 block ID。这一项不影响前五项。

## 6. 需要拍板的事

第 1 条已定（不校验登录，见第 9 节）。剩两条：

第 1 条已定（不校验登录，见第 9 节）。第 2 条也已定并做完：图谱进聊天（见第 4 节 N3）。只剩一条：

| 编号 | 问题 | 我的建议 |
| --- | --- | --- |
| 3 | `evidence` 缺原句怎么办 | 先用关系本身，不等这个 |

## 7. 已知限制

- 当前是词法命中。换个说法可能查不到，这不是连接坏了。
- 只能查到已发布的图谱。
- 一个连接只服务一条流程（常规聊天或医疗咨询）。
- 图谱连接不随账号同步。
- 聊天里的图谱最多 5 条关系、1200 字。超出的关系不进 prompt，不是丢掉整个来源。
- 图谱只提供「A —关系→ B」，没有原文句子。模型能说「这两者有关系」，不能说「书上原话是……」。原文要等 N6。
- 图谱代理不校验登录。上游以后要密钥时，要加回 `authGuard`，并把密钥放在服务端。
- 服务端代理未部署时，页面提示“这个地址上没有接口”。这是正确提示，不是 bug。

## 8. 验证记录

最近一次全量验证（2026-10-28）。项数含第 9 节的复查修复和 N2、N3 的新测试：

| 检查 | 结果 |
| --- | --- |
| 真实接口（含 CORS 探测） | 见第 3 节 |
| `server/apps/api` 图谱 + 知识库路由 vitest | 11 + 11 项通过 |
| `stage-ui` 图谱契约 / 知识库契约 / settings store | 12 + 6 + 10 项通过 |
| `stage-ui` 图谱上下文 + 医疗引用块 | 8 + 4 项通过 |
| `stage-ui` chat 契约回归 | 25 项通过 |
| `stage-web` 构建默认值（含图谱自动下发） | 21 项通过 |
| `stage-ui` / `stage-pages` / `stage-web` / `api-server` typecheck | 通过。`stage-ui` 仅剩既有的 `stage-ui-live2d` 缺导出，与本次无关 |
| `moeru-lint`（图谱与新增文件） | 0 警告 0 错误；全仓 `pnpm lint` 是 13 警告 0 错误，图谱文件已清零 |
| 页面截图 | 两个 Tab 正常；图谱 Tab 有空列表和“只检索已发布图谱、目前按字面命中”的提示；表单有服务地址、API Key、文档 ID（可选）三个字段 |

## 9. 本次未提交代码检查（2026-10-28）

### 已修复

| 问题 | 影响 | 处理 |
| --- | --- | --- |
| `KNOWLEDGE_GRAPH_URL` 是非法地址时，`new URL()` 抛出未处理异常 | API 返回 500，配置错误难定位 | `server/apps/api/src/services/domain/knowledge-graph.ts` 改为返回 503 和 `KNOWLEDGE_GRAPH_INVALID_URL` |
| 设置页填写非法地址时，请求层在拼接 query 时抛异常 | 连接测试不能显示失败状态 | `packages/stage-ui/src/libs/external-service.ts` 改为返回 `unreachable` 失败结果 |
| “已连接数量”包含禁用的连接 | 摘要数量高于可用连接数 | `knowledge-graph-connections.vue` 只统计启用的连接 |
| 代理要求登录，但上游图谱不需要鉴权 | 没账号的访客完全用不了图谱，页面还把 401 说成“API Key 错误” | 去掉该路由的 `authGuard`。理由写在路由文件头：上游不需要密钥，这个路由不保护秘密。知识库代理保留校验，因为它持有密钥。测试改为“没有会话也能访问” |
| 服务端 502 / 503 / 504 没有提示文案 | 配置错误只显示 `HTTP 503 · N 毫秒`，和修之前的 500 一样难定位 | `use-service-probe.ts` 加三条分支；中英各加三条文案；知识库和图谱共用一个实现，所以两边都有了 |
| 图谱实现文件有 lint 警告 | `no-useless-spread`；测试文件另有 `no-unsafe-optional-chaining` | 实现文件改用条件分支和普通对象；测试文件的可选链警告已记录，未影响行为测试 |

### 尚未解决

| 问题 | 后续动作 |
| --- | --- |
| API 尚未部署，线上代理与页面流程没有验收 | 按 N4 部署后实测 |
| 连接只存浏览器，不随账号同步 | 如需跨设备使用，按 N5 接入同步 |
| `evidence` 实际只有 block 定位符，没有原文 | 按 N6 向服务方确认原文接口 |

### 验证

| 检查 | 结果 |
| --- | --- |
| 图谱 API 路由测试 | 11 项通过，包含非法 URL 返回 503、没有会话也能访问 |
| 图谱客户端测试 | 12 项通过，包含非法地址失败状态 |
| 图谱上下文测试 | `knowledge-graph.test.ts` 8 项、`medical-references.test.ts` 4 项通过 |
| 自动下发测试 | `defaults.test.ts` 21 项通过（含新增图谱 5 项） |
| chat 契约回归 | 25 项通过（`context-providers` 的 mock 已补新导出） |
| API 与 `stage-pages` 类型检查 | 通过 |
| `moeru-lint`（图谱与新增文件） | 0 警告 0 错误 |
| 全量 `pnpm lint` | 13 警告 0 错误，图谱文件已清零，剩下的是既有警告 |
| 全量 `pnpm typecheck` | 被既有 `stage-ui-live2d` 测试类型错误阻断，与图谱改动无关 |
