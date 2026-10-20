# API 编排

- 继续使用 `server/apps/api` 作为业务入口，并使用 Hono、Valibot、Drizzle 和 `injeca`。
- 新增 `/api/v1/knowledge-bases/*` 与 `/api/v1/mcp-connections/*` 路由。
- LLM 工具循环可以继续运行在客户端。客户端通过认证 API 取得知识片段和调用 MCP 工具。
- 如果后续把对话编排移到服务端，这两个域服务保持不变。服务端编排只替换调用者。
- 所有外部响应、MCP 内容和任务载荷都通过 Valibot 校验。
- 每次请求生成追踪 ID。日志记录用户 ID、资源 ID、MCP Server ID 和耗时，但不记录密钥或完整文档。
- 单次对话限制知识片段数量、片段总字符数、MCP 工具次数和总执行时间。
- MCP 工具结果经过长度限制后才进入模型上下文。超出部分保存摘要或返回截断标记。

依据：[模块化单体决策](../../ideas/extend-resource-api.md)、[现有后端边界](../../sources/repository/hosted-backend.md)。
