---
tags: [现状]
---

# PostgreSQL 已启用向量扩展，但现有 memory-pgvector 包尚未实现存储

开发数据库使用带向量能力的 PostgreSQL 镜像，并在初始化时创建 `vchord` 扩展。API 也已依赖 PGlite 的向量扩展。`packages/memory-pgvector` 目前只有连接骨架，没有数据表或检索逻辑。知识库可以直接使用现有 PostgreSQL，而不引入独立向量数据库。来源：[`init.sql`](../../../../server/apps/api/sql/init.sql)、[`docker-compose.yaml`](../../../../server/docker-compose.yaml)、[`index.ts`](../../../../packages/memory-pgvector/src/index.ts)。
