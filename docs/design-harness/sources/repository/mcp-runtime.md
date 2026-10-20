---
tags: [现状]
---

# MCP 当前由 Electron 本地运行时提供，后端没有用户级 MCP Broker

桌面端把 `mcp.json` 中的 `stdio` 服务器交给 Electron 主进程。共享 UI 只依赖 `listTools` 和 `callTool` 两个运行时方法。仓库还包含基于官方 TypeScript SDK 的 `computer-use-mcp` 服务，但该服务本身是 MCP Server，不负责保存用户连接或代理远程 MCP Server。后端可以复用共享 UI 的抽象，但必须新增用户级连接、密钥、工具缓存和调用策略。来源：[`mcp.ts`](../../../../packages/stage-ui/src/tools/mcp.ts)、[`mcp-config.ts`](../../../../apps/stage-tamagotchi/src/shared/mcp-config.ts)、[`server.ts`](../../../../services/computer-use-mcp/src/server.ts)。
