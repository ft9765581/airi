---
tags: [现状]
---

# 现有托管后端已经形成清晰的 Auth 与资源 API 边界

仓库已有独立的 Better Auth 服务和 Hono 资源 API。两者共享 PostgreSQL，但只有资源 API 管理迁移。Redis 已用于限流、缓存和跨实例事件。Caddy 只暴露统一入口。现有部署已经包含 API、Auth、PostgreSQL、Redis 和健康检查，因此新增业务能力可以先进入资源 API，而不需要新增部署单元。来源：[`server/README.md`](../../../../server/README.md)、[`server/docker-compose.yaml`](../../../../server/docker-compose.yaml)、[`server/apps/api/README.md`](../../../../server/apps/api/README.md)。
