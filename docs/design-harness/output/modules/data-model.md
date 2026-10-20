# 数据模型

| 表 | 关键字段 | 约束与索引 |
| --- | --- | --- |
| `knowledge_bases` | `id`, `owner_id`, `name`, `retrieval_mode`, `created_at`, `deleted_at` | `(owner_id, id)`；名称可按用户唯一 |
| `knowledge_documents` | `id`, `owner_id`, `knowledge_base_id`, `name`, `content`, `content_hash`, `status`, `version` | `(owner_id, knowledge_base_id)`；父表级联删除 |
| `knowledge_chunks` | `id`, `owner_id`, `knowledge_base_id`, `document_id`, `position`, `content`, `search_vector`, `embedding` | GIN 全文索引；向量索引；`(owner_id, knowledge_base_id)` |
| `knowledge_jobs` | `id`, `owner_id`, `document_id`, `kind`, `status`, `attempts`, `available_at`, `lease_until`, `error_code` | `(status, available_at)`；文档版本用于幂等 |
| `mcp_connections` | `id`, `owner_id`, `name`, `url`, `auth_type`, `encrypted_credentials`, `enabled`, `tool_policy`, `updated_at` | `(owner_id, id)`；URL 不保存内嵌凭据 |
| `mcp_tool_cache` | `connection_id`, `tool_name`, `description`, `input_schema`, `discovered_at` | `(connection_id, tool_name)` 唯一；连接删除时级联 |
| `mcp_call_audit` | `id`, `owner_id`, `connection_id`, `tool_name`, `status`, `duration_ms`, `error_code`, `created_at` | `(owner_id, created_at)`；设置保留期限 |

## 不变量

- 子表冗余保存 `owner_id`。所有查询必须同时匹配所有者和父资源。
- API 不接受客户端指定的 `owner_id`。
- 文档版本进入任务载荷。旧版本任务完成时不能覆盖新版本状态。
- MCP 凭据只在调用时解密。API 响应永远返回凭据是否存在，不返回凭据内容。
- embedding 维度由部署配置固定。不同维度不能写入同一索引。

依据：[用户所有权决策](../../ideas/owner-scoped-data.md)、[PostgreSQL 知识库决策](../../ideas/postgres-knowledge-base.md)。
