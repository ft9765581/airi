# 建议文件结构

```text
server/apps/api/src/
├── routes/
│   ├── knowledge-bases/       # 知识库、文档、检索 HTTP 契约
│   └── mcp-connections/       # MCP 连接、工具发现和调用 HTTP 契约
├── schemas/
│   ├── knowledge-base.ts      # 知识库、文档、片段和任务表
│   └── mcp.ts                 # MCP 连接、工具缓存和审计表
├── services/
│   ├── adapters/
│   │   ├── embeddings/        # OpenAI 兼容 embedding 边界
│   │   └── mcp-client/        # 官方 SDK、传输、SSRF 与超时策略
│   └── domain/
│       ├── knowledge-base/    # 所有权、文档生命周期、分块和检索
│       └── mcp/               # 连接生命周期、工具策略和调用审计
└── workers/
    └── knowledge-indexer/     # 数据库租约、重试和索引任务

packages/stage-ui/src/
├── libs/knowledge-base.ts     # 保留 Dify 外部知识库适配器
└── tools/mcp.ts               # 复用 listTools/callTool 运行时契约
```

# 模块到文件

| 模块 | 主要落点 |
| --- | --- |
| [身份与访问控制](modules/identity-and-access.md) | 现有 `middlewares/auth.ts` 与各域服务所有权检查 |
| [API 编排](modules/api-orchestration.md) | `app.ts`、两个新路由目录 |
| [MCP Broker](modules/mcp-runtime.md) | `services/adapters/mcp-client`、`services/domain/mcp` |
| [知识库](modules/knowledge-base.md) | `services/domain/knowledge-base`、`workers/knowledge-indexer` |
| [数据模型](modules/data-model.md) | `schemas/knowledge-base.ts`、`schemas/mcp.ts`、Drizzle 迁移 |
| [部署与运行](modules/deployment.md) | `app.ts`、`server.ts`、环境变量和现有 compose 配置 |
