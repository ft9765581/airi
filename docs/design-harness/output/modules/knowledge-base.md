# 知识库

- 首版支持粘贴文本、`.txt` 和 `.md`。API 在上传请求中提取 UTF-8 正文。
- `knowledge_bases` 保存用户可见名称、检索配置和索引状态。
- `knowledge_documents` 保存文档名、正文哈希、正文、版本和处理状态。
- `knowledge_chunks` 保存片段文本、标题、顺序、全文检索向量和 embedding。
- 文档写入与索引任务在一个事务中提交。任务失败不会丢失文档。
- 进程内 Worker 从 `knowledge_jobs` 认领任务。它使用 `FOR UPDATE SKIP LOCKED` 防止多实例重复执行。
- Worker 按标题和段落切分文本。默认片段约 500 至 800 tokens，并保留少量重叠。
- 一个部署环境只使用一个 embedding 模型和固定向量维度。模型变更触发显式重建。
- 检索先限制 `owner_id` 与 `knowledge_base_id`，再执行全文或向量查询。
- 首版可以先上线 PostgreSQL 全文检索。启用 embedding 后使用 Reciprocal Rank Fusion 合并两组结果。
- API 返回片段内容、文档名、分数和定位信息。聊天层负责控制注入上下文的总长度。
- 删除知识库时级联删除文档、片段和任务。账户删除调用同一个域服务。
- 保留现有 Dify 请求适配器，但托管知识库使用认证后的内部 API，避免把用户 API Key 暴露给浏览器。

依据：[PostgreSQL 知识库决策](../../ideas/postgres-knowledge-base.md)、[知识库原型](../../sources/repository/knowledge-base.md)、[向量存储现状](../../sources/repository/vector-storage.md)。
