# target — acceptance criteria for output

The human's requirements for output are registered here; output fulfils this list,
and every requirement is checkable. When a requirement changes, the agent re-derives
the affected parts of output in the same turn.

## Purpose

为 AIRI 设计一套可实施的完整后端架构。设计面向项目维护者，优先复用现有代码，并控制首版复杂度。

## Current requirements

- 后端必须支持多个用户，并隔离各用户的数据与运行时访问。
- 后端必须支持连接和调用 MCP 服务。
- 后端必须支持知识库的文档管理、索引和检索。
- 首版必须尽量简单，并提供清晰的后续扩展路径。
- 设计必须说明现有模块的复用方式、数据模型、请求流程、部署方式和实施顺序。

## Fulfilment map

- 多用户与数据隔离 → `output/system.md`、`output/modules/identity-and-access.md`、`output/modules/data-model.md`
- MCP → `output/system.md`、`output/modules/mcp-runtime.md`
- 知识库 → `output/system.md`、`output/modules/knowledge-base.md`
- 简化原则与扩展路径 → `output/modules/deployment.md`、`output/implementation-plan.md`
- 现有模块复用与文件布局 → `output/file-structure.md`
