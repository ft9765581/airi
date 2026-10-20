---
id: owner-scoped-data
type: idea
tags: [隔离]
---

# 每个新增业务对象必须有明确的用户所有者

知识库、文档、MCP 连接和调用记录必须从认证上下文取得 `owner_id`。客户端不能提交或覆盖所有者字段。该判断满足多用户要求，并沿用[现有身份与聊天访问控制](../sources/repository/identity-and-chat.md)。
