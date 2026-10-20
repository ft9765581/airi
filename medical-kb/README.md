# 自建知识库服务（零依赖）

给 AIRI 前端用的**自建知识库检索服务**。不需要 Dify，不需要装任何 Python 包（只用标准库），
也不需要向量数据库 —— 召回用的是 BM25（中文按「单字 + 相邻两字」切词）。

## 为什么这样能直接用

前端只要求一个 HTTP 接口，格式是 Dify 外部知识库那套（见
[`libs/knowledge-base.ts`](../packages/stage-ui/src/libs/knowledge-base.ts)）：

```http
POST <baseUrl>
Authorization: Bearer <API Key>        # 设置里填了才发
Content-Type: application/json

{ "knowledge_id": "postpartum", "query": "涨奶怎么办",
  "retrieval_setting": { "top_k": 5, "score_threshold": 0 } }
```

```json
{ "records": [{ "content": "…", "score": 0.83, "title": "产后访视 · 第2段" }] }
```

只要按这个格式回答，**前端一行代码都不用改**。

## 跑起来

```sh
cd medical-kb
python kb_server.py
# → http://localhost:5181/api/retrieval
```

可选环境变量：

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `PORT` | `5181` | 监听端口 |
| `KB_DIR` | `./docs` | 语料根目录 |
| `KB_API_KEY` | 空 | 设了之后请求必须带 `Authorization: Bearer <key>` |

## 加你自己的文档

```
docs/
  postpartum/          ← 目录名 = 前端「知识库 ID」
    产后访视.md
    母乳喂养.md
  newborn/             ← 可以有很多个知识库
    新生儿照护.md
```

支持 `.md` 和 `.txt`（UTF-8）。加完文档后：

```sh
curl -X POST http://localhost:5181/reload
```

（或者直接重启进程，启动时就会重建索引。）

## 验证

```sh
curl -s http://localhost:5181/health
curl -s -X POST http://localhost:5181/api/retrieval \
  -H "Content-Type: application/json" \
  -d '{"knowledge_id":"postpartum","query":"涨奶疼得睡不着","retrieval_setting":{"top_k":3,"score_threshold":0}}'
```

## 在应用里连上

设置 → 知识库 → 新增：

| 字段 | 本地开发 | 线上部署 |
| --- | --- | --- |
| 名称 | 产后访视 | 产后访视 |
| Base URL | `http://localhost:5181/api/retrieval` | `https://你的域名/api/retrieval` |
| API Key | 留空（未设 `KB_API_KEY`） | 与服务器 `KB_API_KEY` 一致 |
| 知识库 ID | `postpartum` | `postpartum` |

点「测试」看到记录数就算通了；之后每次对话会自动检索并注入上下文。

## 升级路线（按需）

1. **语义检索**：现在的 BM25 对「指南/手册」类语料已经够用；要更懂同义说法，
   可以换成向量检索 —— 最省事的是在你这台 vLLM 上加一个 embedding 模型
   （如 `BAAI/bge-m3`），用它算向量，再把这个服务的打分函数替换掉。
2. **混合检索**：BM25 + 向量各取前 N 条，再合并去重。
3. **重新排序**：加一个 cross-encoder 或让大模型给候选段落打分。

这三点都不需要改前端。
