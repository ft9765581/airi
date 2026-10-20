# 部署与运行

- 保持现有五个本地容器：Caddy、API、Auth、PostgreSQL 和 Redis。
- 不新增向量数据库、消息队列、对象存储或独立 Worker 容器。
- API 进程启动一个受并发限制的知识库任务循环。`KNOWLEDGE_WORKER_ENABLED` 可以关闭该循环。
- Railway 多实例通过数据库租约分配任务。实例退出后，过期租约允许其他实例重试。
- Redis 只保存 MCP 工具短期缓存、限流计数和跨实例失效通知。PostgreSQL 保存真实状态。
- 新增环境变量只包含 embedding Provider、模型、维度、任务并发和 MCP 出站策略。
- `/readyz` 检查 PostgreSQL、Redis 和迁移状态。外部 MCP 与 embedding Provider 不阻止 API 就绪。
- OpenTelemetry 记录索引队列深度、索引耗时、检索耗时、MCP 调用状态和外部依赖错误。
- 当索引工作明显影响 API 延迟时，把同一任务执行器移入独立 Worker。数据库任务契约保持不变。

依据：[模块化单体决策](../../ideas/extend-resource-api.md)、[现有部署](../../sources/repository/hosted-backend.md)。
