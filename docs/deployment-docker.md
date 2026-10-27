# Docker 部署指南

标签：维护中 · 部署指南

这份文档描述如何把本仓库部署到一台自己的 Linux 服务器上，全部用 Docker 跑。
每一步都对应仓库里真实存在的文件和变量名，不是示意。

> 适用对象：单台服务器、2 GB 内存以上、有公网域名。
> 如果你的服务器由宝塔管理，先看第 8 节。

---

## 1. 仓库里现有什么

先分清「可以直接用」和「必须自己补」，否则会照着一份开发用的 compose 部署到公网。

| 文件 | 用途 | 能否直接用于生产 |
| --- | --- | --- |
| `server/apps/api/Dockerfile` | 资源 API 镜像（`node:24-alpine`） | **可以** |
| `server/apps/auth/Dockerfile` | 认证服务镜像（`node:24-alpine`） | **可以** |
| `apps/stage-web/Dockerfile` | 主应用静态站（nginx） | 可以，但要加一个构建参数（见 4.3） |
| `server/docker-compose.yaml` | **本地开发**栈 | **不能** —— 只绑 `127.0.0.1:6112`、数据库密码写死、无 TLS |
| `server/dev/caddy/Caddyfile` | 本地反代 | **不能** —— 没有域名和证书 |
| `apps/stage-web/deploy/` | 仅前端的单机部署 | 只覆盖前端，不含后端 |
| `apps/ui-server-auth` | 账号界面 | **缺 Dockerfile**，本文补 |
| — | 生产 compose、生产 Caddyfile | **缺**，本文补 |

**关键事实**：本仓库有**两个前端**，它们的构建产物都用 `/assets/` 目录，所以
**必须放在两个不同的域名（或子域名）上**，不能用路径区分。

---

## 2. 目标架构

```
                    ┌──────────────────────────────────────┐
  example.com  ────►│  caddy (80/443, 自动 TLS)            │
                    │                                      │
                    │  /api/auth/*  → auth:3000            │
                    │  /auth/*      → auth:3000            │
                    │  /.well-known … → auth:3000          │
                    │  /api/*       → api:3000             │
                    │  /ws/*        → api:3000  (WebSocket)│
                    │  /internal/*  → 404                  │
                    │  其它          → web:80  (stage-web)  │
                    └───────────────┬──────────────────────┘
                                    │  内部网络
                    ┌───────────────┴───────────┐
                    │  api:3000                 │
                    │  auth:3000                │
                    └───────┬───────────┬───────┘
                            │           │
                     ┌──────▼───┐  ┌────▼─────┐
                     │  db      │  │  redis   │
                     │ (pg18 +  │  │          │
                     │  vchord) │  │          │
                     └──────────┘  └──────────┘

  accounts.example.com ──► accounts:80  (ui-server-auth)
```

三个域名：

| 域名 | 内容 | 说明 |
| --- | --- | --- |
| `example.com` | 主应用 + 后端 | 护士对话、设置、`/api/*`、`/ws/*` |
| `accounts.example.com` | 账号界面 | 登录、注册、改密码、删号 |

`accounts` 单独一个域名的原因只有一条：**两个前端的静态资源路径冲突**。

---

## 3. 前置条件

| 项 | 要求 | 检查命令 |
| --- | --- | --- |
| Docker | 24 以上 | `docker --version` |
| Docker Compose | **2.24 以上**（本文的 compose 用了 `env_file.required`） | `docker compose version` |
| 内存 | 建议 ≥ 2 GB | `free -h` |
| 磁盘 | ≥ 10 GB（镜像 + 数据） | `df -h` |
| 域名 | 三条 A 记录指向服务器 | `dig +short example.com` |
| 端口 | 80、443 空闲 | `ss -lntp \| grep -E ':(80\|443)'` |

前端镜像的构建相当吃内存（Node + Vite + 文档站）。**如果服务器内存小于 2 GB，
按第 7.2 节在本地构建前端，服务器只跑后端容器。**

---

## 4. 部署步骤

### 4.1 目录结构

在仓库根目录下新建 `deploy/`：

```
你的仓库/
├── deploy/
│   ├── .env                      ← 密钥，绝不提交
│   ├── .env.example
│   ├── docker-compose.yaml
│   ├── Caddyfile
│   ├── accounts.Dockerfile
│   └── accounts-nginx.conf
├── apps/stage-web/Dockerfile     ← 要改一处（4.3）
└── server/docker-compose.yaml    ← 本地开发用，生产不用它
```

### 4.2 新建文件

#### `deploy/.env.example`

```dotenv
# 三个域名
APP_DOMAIN=example.com
ACCOUNTS_DOMAIN=accounts.example.com

# 数据库。密码只用字母、数字和 -，因为它会被拼进 DATABASE_URL。
POSTGRES_DB=postgres
POSTGRES_USER=postgres
POSTGRES_PASSWORD=change-me-to-a-long-url-safe-secret
REDIS_PASSWORD=change-me-to-another-long-secret

# 认证服务签名密钥。生成方式见下面「必须自己生成的三个值」。
BETTER_AUTH_SECRET=

# 上游模型凭证的加密主密钥（base64 编码的 32 字节）
LLM_ROUTER_MASTER_KEY=

# 网关是否计费。enforce = 需要 Flux 余额；off = 免费。
OPENAI_GATEWAY_BILLING_MODE=enforce

# 邮件（可选）。不填则不发验证邮件，注册直接可用。
RESEND_API_KEY=
```

复制成 `.env` 并填值：`cp .env.example .env`。

**必须自己生成的三个值**：

```sh
# BETTER_AUTH_SECRET：任意 32 字节以上的随机串
openssl rand -base64 32

# LLM_ROUTER_MASTER_KEY：严格 32 字节，base64 编码
openssl rand -base64 32

# POSTGRES_PASSWORD / REDIS_PASSWORD：用 URL 安全字符
openssl rand -hex 24
```

#### `deploy/docker-compose.yaml`

```yaml
name: airi

services:
  db:
    image: ghcr.io/tensorchord/vchord-postgres:pg18-v1.0.0
    restart: unless-stopped
    environment:
      POSTGRES_DB: ${POSTGRES_DB}
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      # 这个镜像需要 vchord 扩展，初始化脚本会创建它
      - ../server/apps/api/sql/init.sql:/docker-entrypoint-initdb.d/init.sql:ro
      - db_data:/var/lib/postgresql
    # 不映射端口：只有内部网络能访问
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U $${POSTGRES_USER} -d $${POSTGRES_DB}']
      interval: 5s
      timeout: 5s
      retries: 10

  redis:
    image: redis:7-alpine
    restart: unless-stopped
    command: ['redis-server', '--requirepass', '${REDIS_PASSWORD}', '--appendonly', 'yes']
    volumes:
      - redis_data:/data
    healthcheck:
      test: ['CMD', 'redis-cli', '-a', '${REDIS_PASSWORD}', 'ping']
      interval: 5s
      timeout: 5s
      retries: 10

  api:
    build:
      context: ..
      dockerfile: server/apps/api/Dockerfile
    restart: unless-stopped
    depends_on:
      db: {condition: service_healthy}
      redis: {condition: service_healthy}
    environment:
      DATABASE_URL: postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@db:5432/${POSTGRES_DB}
      REDIS_URL: redis://:${REDIS_PASSWORD}@redis:6379
      # 对外地址：签发/校验 JWT 的 issuer 和 audience 都用它。
      # 必须与 auth 服务的 PUBLIC_URL 完全一致，否则所有请求都会 401。
      API_SERVER_URL: https://${APP_DOMAIN}
      AUTH_SERVER_URL: https://${APP_DOMAIN}
      # 容器之间直连，绕开公网
      AUTH_SERVER_INTERNAL_URL: http://auth:3000
      WEB_APP_URL: https://${APP_DOMAIN}
      # 账号界面是另一个域名，必须显式信任，否则 CORS 和 cookie 都会失败
      ADDITIONAL_TRUSTED_ORIGINS: https://${ACCOUNTS_DOMAIN}
      LLM_ROUTER_MASTER_KEY: ${LLM_ROUTER_MASTER_KEY}
      OPENAI_GATEWAY_BILLING_MODE: ${OPENAI_GATEWAY_BILLING_MODE:-enforce}
    healthcheck:
      test: ['CMD-SHELL', 'wget -qO- http://localhost:3000/readyz >/dev/null']
      interval: 10s
      timeout: 5s
      retries: 10

  auth:
    build:
      context: ..
      dockerfile: server/apps/auth/Dockerfile
    restart: unless-stopped
    depends_on:
      api: {condition: service_healthy}
    environment:
      DATABASE_URL: postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@db:5432/${POSTGRES_DB}
      REDIS_URL: redis://:${REDIS_PASSWORD}@redis:6379
      PUBLIC_URL: https://${APP_DOMAIN}
      # 服务端之间互调走容器网络
      RESOURCE_SERVER_URL: http://api:3000
      # 账号界面地址。登录流程会把 /auth/* 重定向到这里。
      AUTH_UI_URL: https://${ACCOUNTS_DOMAIN}/ui
      BETTER_AUTH_SECRET: ${BETTER_AUTH_SECRET}
      ADDITIONAL_TRUSTED_ORIGINS: https://${ACCOUNTS_DOMAIN}
      RESEND_API_KEY: ${RESEND_API_KEY:-}
    healthcheck:
      test: ['CMD-SHELL', 'wget -qO- http://localhost:3000/readyz >/dev/null']
      interval: 10s
      timeout: 5s
      retries: 10

  web:
    build:
      context: ..
      dockerfile: apps/stage-web/Dockerfile
      args:
        VITE_SERVER_URL: https://${APP_DOMAIN}
    restart: unless-stopped

  accounts:
    build:
      context: ..
      dockerfile: deploy/accounts.Dockerfile
      args:
        VITE_SERVER_URL: https://${APP_DOMAIN}
    restart: unless-stopped

  gateway:
    image: caddy:2-alpine
    restart: unless-stopped
    depends_on:
      api: {condition: service_healthy}
      auth: {condition: service_healthy}
      web: {condition: service_started}
      accounts: {condition: service_started}
    ports:
      - '80:80'
      - '443:443'
      - '443:443/udp'
    environment:
      APP_DOMAIN: ${APP_DOMAIN}
      ACCOUNTS_DOMAIN: ${ACCOUNTS_DOMAIN}
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
      - caddy_config:/config

volumes:
  db_data:
  redis_data:
  caddy_data:
  caddy_config:
```

#### `deploy/Caddyfile`

```caddy
{$APP_DOMAIN} {
	encode zstd gzip

	# 内部端点只在容器网络里可用
	@internal path /internal /internal/*
	respond @internal 404

	# 认证服务：注意这三组路径必须排在 /api/* 前面
	@auth path /api/auth /api/auth/* /auth /auth/* /.well-known/oauth-authorization-server/api/auth
	reverse_proxy @auth auth:3000

	# 资源 API（含 WebSocket，Caddy 自动处理 Upgrade）
	@api path /api/* /ws /ws/*
	reverse_proxy @api api:3000

	# 其余都是主应用的静态文件
	reverse_proxy web:80
}

{$ACCOUNTS_DOMAIN} {
	encode zstd gzip
	reverse_proxy accounts:80
}
```

#### `deploy/accounts.Dockerfile`

仓库没有账号界面的 Dockerfile，补一个。结构和 `apps/stage-web/Dockerfile` 一致。

```dockerfile
FROM node:24-trixie AS build-stage

WORKDIR /app

# 构建期注入后端地址。不设的话会退回官方的 https://api.airi.build。
ARG VITE_SERVER_URL
ENV VITE_SERVER_URL=${VITE_SERVER_URL}

RUN apt update && apt install -y ca-certificates curl build-essential python3 python3-setuptools

RUN corepack enable

COPY . .

RUN --mount=type=cache,id=pnpm-store,target=/root/.pnpm-store \
    pnpm install --frozen-lockfile

RUN pnpm -F @proj-airi/ui-server-auth run build

FROM nginx:stable-alpine AS production-stage

COPY --from=build-stage /app/apps/ui-server-auth/dist /usr/share/nginx/html
COPY deploy/accounts-nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
```

#### `deploy/accounts-nginx.conf`

```nginx
server {
    listen 80;
    server_name _;

    root /usr/share/nginx/html;
    index index.html;

    # 单页应用：路由都在 /ui/*，刷新时交回 index.html
    location / {
        try_files $uri $uri/ /index.html;
    }

    location ~* \.(?:js|css|woff2?|ttf|png|jpe?g|svg|ico|webp)$ {
        expires 7d;
        add_header Cache-Control "public, immutable";
        try_files $uri =404;
    }
}
```

### 4.3 要改的一处已有文件

`apps/stage-web/Dockerfile` 目前只接受 `VITE_ENABLE_POSTHOG` 一个构建参数，
没有 `VITE_SERVER_URL`，所以打出来的包会指向官方后端。

在第 5 行附近补两行：

```dockerfile
ARG VITE_ENABLE_POSTHOG=false
ENV VITE_ENABLE_POSTHOG=${VITE_ENABLE_POSTHOG}

# 新增：后端地址在构建期写死进 bundle
ARG VITE_SERVER_URL
ENV VITE_SERVER_URL=${VITE_SERVER_URL}
```

> 密钥不会被打进镜像：根目录的 `.dockerignore` 已经排除 `**/.env` 和 `**/.env.*`，
> 只保留 `.env.example`。**但如果你不用 Docker、直接在服务器上 `pnpm build`，
> 就必须先把 `apps/stage-web/.env.local` 移走**，否则真实密钥会进 bundle。

### 4.4 构建与启动

```sh
cd deploy
cp .env.example .env
# 编辑 .env，填好 4 个密钥和 3 个域名

docker compose build
docker compose up -d
docker compose ps
```

第一次启动时 `api` 会自动建表并应用 schema（日志里的 `Applied schema on attempt 1`），
不需要手动跑迁移。

看日志：

```sh
docker compose logs -f api auth gateway
```

Caddy 在第一个请求到达时向 Let's Encrypt 申请证书，需要域名已解析到本机、80 端口可达。

### 4.5 播种模型网关（只有走服务端网关时才需要）

`/api/v1/openai` 需要三样东西才能工作，仓库提供了一个脚本写入它们：

```sh
cd deploy

# 把上游 key 和模型名传给容器
docker compose run --rm \
  -e DEEPSEEK_API_KEY=sk-你的key \
  -e DEEPSEEK_BASE_URL=https://api.deepseek.com/v1 \
  -e GATEWAY_MODEL_ID=deepseek-flash \
  api pnpm -F @proj-airi/api-server run seed:gateway
```

脚本做的事：

1. 用 `LLM_ROUTER_MASTER_KEY` 加密上游 key，**只写密文**
2. 写 `config_kv` 的 `LLM_ROUTER_CONFIG`
3. 建 `capability_aliases` 的 `auto` 别名和它的路由
4. 清掉 Redis 里的配置缓存

写完后客户端要用 **`model: "auto"`** 调用，不是 `deepseek-flash`。

> 如果前端仍然让浏览器直连上游（当前默认），这一步可以先不做。

### 4.6 验证

按顺序执行，任何一步失败都别看下一步。

```sh
# 1. 容器都活着
docker compose ps          # 所有服务应为 running / healthy

# 2. API 健康检查（容器内）
docker compose exec api wget -qO- http://localhost:3000/readyz

# 3. 认证服务健康检查
docker compose exec auth wget -qO- http://localhost:3000/readyz

# 4. 网关路由（对外）
curl -i https://example.com/api/v1/providers        # 期望 401（要鉴权）
curl -i https://example.com/api/v1/nope             # 期望 404
curl -s https://example.com/api/auth/ok             # 期望 200

# 5. 两个前端
curl -s -o /dev/null -w '%{http_code}\n' https://example.com/
curl -s -o /dev/null -w '%{http_code}\n' https://accounts.example.com/ui/

# 6. 证书
curl -vI https://example.com 2>&1 | grep -E 'subject|issuer|expire'
```

浏览器里再走一遍：

1. 打开 `https://accounts.example.com/ui/`，注册一个手机号账号
2. 打开 `https://example.com`，进设置 → 账号 → 点「登录」，应跳转到账号界面
3. 登录成功后回到主应用，头像出现
4. 发一条对话，刷新页面，历史还在

---

## 5. 升级

```sh
git pull
cd deploy
docker compose build
docker compose up -d
```

`api` 启动时会自动应用 schema 变更。**先备份数据库**：

```sh
docker compose exec -T db pg_dump -U postgres postgres > backup-$(date +%F).sql
```

前端更新后 nginx 直接生效，不需要重启容器。

---

## 6. 常见坑

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| **所有 API 都返回 401** | `AUTH_SERVER_URL` 与 auth 的 `PUBLIC_URL` 不一致 | 两者必须是同一个值。API 用 `issuer = ${AUTH_SERVER_URL}/api/auth` 校验，签发方用的是 `PUBLIC_URL` |
| 登录后主应用仍是匿名 | 只在账号界面登录了，主应用没拿到 token | 必须**从主应用**点「登录」发起流程；账号界面单独登录只给 cookie |
| `CORS` 报错 | 漏了 `ADDITIONAL_TRUSTED_ORIGINS` | 两个服务都要加 `https://${ACCOUNTS_DOMAIN}` |
| WebSocket 连不上 | 反代没转发 `/ws/*` | 检查 Caddyfile 的 `@api` 规则 |
| 数据库起不来 | `vchord` 扩展缺失 | 必须用 `vchord-postgres` 镜像，并挂载 `init.sql` |
| `DATABASE_URL` 解析失败 | 密码含 `@ : / #` | 用 `openssl rand -hex` 生成 URL 安全密码 |
| 证书申请失败 | 80 端口被占用或域名未解析 | `ss -lntp \| grep :80`，`dig +short 你的域名` |
| 构建时 OOM | 服务器内存不足 | 见 7.2，在本地构建前端 |
| 前端仍连官方后端 | 忘了 4.3 的 `VITE_SERVER_URL` | 重新 `docker compose build web accounts` |
| 对话历史不跨设备 | 未登录，或没走完 OIDC | 看浏览器控制台是否有 `[chat-sync] WS skipped: anonymous user` |

### 最容易踩的两个

**1. `AUTH_SERVER_URL` ≠ `PUBLIC_URL`**

API 校验 token 用的是：

```ts
issuer: `${env.AUTH_SERVER_URL}/api/auth`
audience: env.AUTH_SERVER_URL
```

而签发方（auth 服务）用 `PUBLIC_URL` 派生自己的 base。两个值一旦不同，
API 会认为所有 token 都不是它信任的签发者签发，**每个请求都 401**，
日志里只有一行验签失败，很难联想到是配置不一致。

**2. 只在账号界面登录**

账号界面登录只种 cookie。主应用要的是 OIDC access token，必须**从主应用**发起登录。
这是上游设计（主应用用 Bearer，不用 cookie），不是 bug。

**密码是 6 位、邮箱验证是关闭的** —— 这两处是为了内测临时改的，
台账 `docs/fork-changes.md` 第 7 节记着，公开前必须改回。

---

## 7. 资源受限时的变通

### 7.1 内存 2 GB 左右

只跑后端，前端用 nginx 托管静态文件：

```sh
docker compose up -d db redis api auth gateway
# 不启动 web 和 accounts
```

前端在别处构建后把 `dist` 上传，由宿主机的 nginx 服务。

### 7.2 构建不放在服务器上

前端镜像构建需要 2–4 GB 内存。改成在本地或 CI 构建，服务器只拿产物：

```sh
# 本地
pnpm install
pnpm build:packages
VITE_SERVER_URL=https://example.com pnpm -F @proj-airi/stage-web build
VITE_SERVER_URL=https://example.com pnpm -F @proj-airi/ui-server-auth build

# 上传（用 rsync 才能删掉旧文件）
rsync -av --delete apps/stage-web/dist/ user@server:/srv/airi-web/dist/
rsync -av --delete apps/ui-server-auth/dist/ user@server:/srv/airi-accounts/dist/
```

然后宿主机 nginx 直接指向这两个目录，`web` / `accounts` 容器都可以不要。

---

## 8. 宝塔场景

宝塔的 Node 版本**不影响**这个项目 —— 下面这条路完全不使用宝塔的 Node。

### 8.1 Docker 跑后端

```sh
cd /www/wwwroot/你的项目/deploy
docker compose up -d db redis api auth
```

不要启动 `gateway`（宝塔的 nginx 已经在占 80/443）。

### 8.2 宝塔 nginx 做入口

新建站点，把下面这段加进配置文件的反代部分（等价于 `Caddyfile` 的规则）：

```nginx
location ^~ /api/auth/ { proxy_pass http://127.0.0.1:3000; }
location ^~ /auth/     { proxy_pass http://127.0.0.1:3000; }
location ^~ /.well-known/oauth-authorization-server/api/auth { proxy_pass http://127.0.0.1:3000; }
location ^~ /api/      { proxy_pass http://127.0.0.1:3000; }

location ^~ /ws/ {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 3600s;
}

location / { root /www/wwwroot/你的项目/apps/stage-web/dist; try_files $uri $uri/ /index.html; }
```

但 `api` 容器默认没有映射端口，需要在 compose 里给它加：

```yaml
ports:
  - '127.0.0.1:3000:3000'
```

### 8.3 系统版本的限制

| 系统 | 能不能装 Node 24 | 建议 |
| --- | --- | --- |
| Ubuntu 20.04+ / Debian 11+ | 能 | Docker 或直接装都行 |
| CentOS 7 | **不能**（glibc 2.17 < 2.28） | 必须用 Docker |
| 宝塔 7.x | 没有 Docker 图形界面 | 命令行装 docker + compose 即可 |

---

## 9. 附录：环境变量清单

### api（`server/apps/api/src/libs/env.ts`）

| 变量 | 必填 | 默认值 | 生产要设 |
| --- | --- | --- | --- |
| `DATABASE_URL` | **是** | — | 是 |
| `REDIS_URL` | **是** | — | 是 |
| `LLM_ROUTER_MASTER_KEY` | **是** | — | 是（32 字节 base64） |
| `API_SERVER_URL` | 否 | `http://localhost:3000` | 是 |
| `AUTH_SERVER_URL` | 否 | `http://localhost:3000` | 是 |
| `AUTH_SERVER_INTERNAL_URL` | 否 | 同 `AUTH_SERVER_URL` | 是（容器内地址） |
| `WEB_APP_URL` | 否 | `https://airi.moeru.ai` | 是 |
| `ADDITIONAL_TRUSTED_ORIGINS` | 否 | — | 是（账号界面域名） |
| `OPENAI_GATEWAY_BILLING_MODE` | 否 | `enforce` | 是 |
| `LLM_ROUTER_MASTER_KEY_PREVIOUS` | 否 | — | 仅轮换密钥时 |

### auth（`server/apps/auth/src/env.ts`）

| 变量 | 必填 | 默认值 | 生产要设 |
| --- | --- | --- | --- |
| `DATABASE_URL` | **是** | — | 是 |
| `REDIS_URL` | **是** | — | 是 |
| `BETTER_AUTH_SECRET` | **是** | — | 是 |
| `PUBLIC_URL` | 否 | `http://localhost:3000` | 是 |
| `RESOURCE_SERVER_URL` | 否 | `http://localhost:3001` | 是（容器内地址） |
| `AUTH_UI_URL` | 否 | `https://accounts.airi.build/ui` | 是 |
| `ADDITIONAL_TRUSTED_ORIGINS` | 否 | — | 是 |
| `AUTH_RATE_LIMIT_MAX` | 否 | `20` | 按需 |
| `AUTH_RATE_LIMIT_WINDOW_SEC` | 否 | `60` | 按需 |
| `RESEND_API_KEY` | 否 | 空 | 需要邮件时 |

### 前端（构建期）

| 变量 | 作用 |
| --- | --- |
| `VITE_SERVER_URL` | 后端地址。**不设会连到官方 `https://api.airi.build`** |
| `VITE_DEFAULT_CONFIG_VERSION` | 部署默认值的版本号，改了才会重新写入 |
| `VITE_PROVIDER_PURGE_VERSION` | 换上游 key 后加一，让老浏览器丢弃旧凭证 |
| `VITE_DEFAULT_DISPLAY_MODEL` | 默认形象，如 `preset-live2d-chun-nurse` |

---

## 10. 还没做的事

| 项 | 状态 |
| --- | --- |
| `deploy/` 目录本身 | 文档提供内容，仓库里**还没有**这些文件 |
| `apps/ui-server-auth/Dockerfile` | 同上，第 4.2 节提供了 |
| 生产 Caddyfile | 同上 |
| 备份与监控 | 未配置，建议至少加 `pg_dump` 定时任务 |
| HTTPS 强制跳转 | Caddy 自动处理；用宝塔 nginx 时要自己加 |
