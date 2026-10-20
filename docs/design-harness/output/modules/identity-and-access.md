# 身份与访问控制

- Auth 服务继续负责注册、登录、会话、OIDC 和账户删除。
- 资源 API 继续本地校验 OIDC JWT。业务路由只读取认证上下文中的 `user.id`。
- `knowledge_bases`、`knowledge_documents`、`mcp_connections` 和调用审计记录都保存 `owner_id`。
- 创建操作忽略请求中的所有者字段。服务层使用当前用户 ID 写入所有者。
- 读取、修改和删除操作同时匹配资源 ID 与 `owner_id`。不存在和无权限统一返回 `404`。
- 聊天共享继续使用 `chat_members`。首版知识库和 MCP 连接不支持跨用户共享。
- 账户删除先通过现有私有接口删除知识库、分块、MCP 密钥和调用记录，再删除 Auth 数据。
- API Key、MCP Bearer Token 和 OAuth Refresh Token 使用现有 Envelope Crypto 加密后保存。
- 数据库索引必须以 `owner_id` 开头，防止跨用户列表和检索退化为全表扫描。

依据：[用户所有权决策](../../ideas/owner-scoped-data.md)、[现有身份实现](../../sources/repository/identity-and-chat.md)。
