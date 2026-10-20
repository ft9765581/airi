---
tags: [现状]
---

# 现有 API 已按用户身份执行聊天和配置访问控制

Auth 服务签发 OIDC JWT。资源 API 本地校验令牌，并把用户身份写入 Hono 上下文。聊天服务通过 `chat_members` 校验成员资格。用户 Provider 配置使用 `owner_id` 隔离。WebSocket v2 在连接建立后完成认证。新增知识库和 MCP 数据可以沿用相同的身份解析与服务层授权方式。来源：[`request-auth.ts`](../../../../server/apps/api/src/libs/request-auth.ts)、[`chats.ts`](../../../../server/apps/api/src/services/domain/chats.ts)、[`providers.ts`](../../../../server/apps/api/src/schemas/providers.ts)、[`auth.ts`](../../../../server/apps/auth/src/auth.ts)。
