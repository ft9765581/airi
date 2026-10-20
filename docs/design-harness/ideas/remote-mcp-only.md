---
id: remote-mcp-only
type: idea
tags: [MCP]
---

# 托管后端首版只连接远程 Streamable HTTP MCP Server

云端不能安全地为普通用户启动任意 `stdio` 命令。Electron 继续管理本地 `stdio` MCP。后端只代理远程 MCP，并复用共享 UI 的工具发现与调用抽象。该判断基于[当前 MCP 运行方式](../sources/repository/mcp-runtime.md)。
