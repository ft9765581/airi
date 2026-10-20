# MCP Broker

- 首版只支持远程 Streamable HTTP。Electron 的本地 `stdio` MCP 保持现状。
- 使用仓库已有的 `@modelcontextprotocol/sdk` 创建短生命周期 MCP Client。
- `mcp_connections` 保存名称、URL、认证方式、加密凭据、启用状态和工具策略。
- `POST /api/v1/mcp-connections` 创建连接。服务端先校验 URL，再执行 `initialize` 和 `tools/list`。
- `GET /api/v1/mcp-connections/:id/tools` 返回缓存的工具描述。缓存可以按连接更新或按 TTL 失效。
- `POST /api/v1/mcp-connections/:id/tools/:toolName/call` 调用工具。服务端再次检查所有权、启用状态和允许列表。
- 连接 URL 只允许 `https`。开发环境可以显式允许 `http://localhost`。
- DNS 解析后拒绝 loopback、link-local、私网和云元数据地址。每次重定向后再次检查目标地址。
- 请求限制连接时间、总时间、响应字节数和并发数。断开客户端连接时取消上游调用。
- 首版使用 Bearer Token 或无认证。OAuth 授权流程可在后续增加，不改变连接表的所有权模型。
- 工具默认全部禁用，或在首次连接时由用户明确选择。高风险工具可以要求每次确认。
- 调用审计只保存工具名、状态、耗时和错误代码。默认不保存参数与结果正文。

依据：[远程 MCP 决策](../../ideas/remote-mcp-only.md)、[当前 MCP 运行方式](../../sources/repository/mcp-runtime.md)。
