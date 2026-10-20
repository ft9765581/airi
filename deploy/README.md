# 宝塔部署（后端 server）

本目录只做一件事：用 Docker 跑起后端。前端静态文件由宝塔 nginx 托管，不用容器。

宝塔的「添加 Node 项目」在这个场景里用不上 —— 后端要同时跑数据库、Redis、api、auth 四个
服务，单个 Node 进程管理面板管不了。完整背景见 `docs/deployment-docker.md`。

## 文件

| 文件 | 用途 |
| --- | --- |
| `docker-compose.yaml` | db / redis / api / auth 四个服务 |
| `.env.example` | 环境变量模板，复制成 `.env` 再改 |
| `baota-nginx.conf` | 粘进宝塔站点配置的 nginx 反代片段 |
| `README.md` | 本文件 |

## 步骤

### 1. 服务器准备

内存最好 4 GB。2 GB 首次构建容易被杀，构建失败先看内存。

```sh
docker --version          # 需要 20 以上
docker compose version    # 需要 v2
```

宝塔 9.x 左侧有「Docker」菜单；装了 Docker 就有 compose，不用单独装。

### 2. 把仓库放到服务器

```sh
cd /www/wwwroot
git clone <仓库地址> airi
cd airi
```

仓库很大，clone 慢可以本地打包上传（排除 `node_modules`、`.git`、`apps/stage-web/dist`），
解压到 `/www/wwwroot/airi`。

**目录结构必须是** `/www/wwwroot/airi/deploy/docker-compose.yaml`，
因为 compose 里的 `context: ..` 指向仓库根目录。

### 3. 配置密钥

```sh
cd deploy
cp .env.example .env
vim .env
```

四个值必须自己生成，不能留空：

```sh
openssl rand -base64 32   # BETTER_AUTH_SECRET
openssl rand -base64 32   # LLM_ROUTER_MASTER_KEY
openssl rand -hex 24      # POSTGRES_PASSWORD（只能用字母数字）
openssl rand -hex 24      # REDIS_PASSWORD
```

`APP_DOMAIN` 填主应用域名，`ACCOUNTS_DOMAIN` 填账号界面域名，两者必须不同。

### 4. 拉镜像

国内服务器拉 `ghcr.io` 经常超时。先在宝塔 Docker → 设置里配镜像加速，
然后单独试一下数据库镜像能不能拉下来：

```sh
docker pull ghcr.io/tensorchord/vchord-postgres:pg18-v1.0.0
```

这一步过不去，后面全都起不来。

### 5. 启动

```sh
cd /www/wwwroot/airi/deploy
docker compose build
docker compose up -d
docker compose ps
```

第一次启动 api 会自动建表（日志里出现 `Applied schema on attempt 1`），不需要手动迁移。

看日志：

```sh
docker compose logs -f api
```

### 6. 宝塔 nginx 反代

新建站点（类型选纯静态），根目录指向前端 `dist`，然后在
「设置 → 配置文件」里把 `baota-nginx.conf` 的内容粘进 `server { }`，重载 nginx。

### 7. 验证

```sh
# 两个容器自己活着（/readyz 在容器根的 /，不走 nginx）
curl -i http://127.0.0.1:3000/readyz
curl -i http://127.0.0.1:3001/readyz

# 从公网访问，确认反代和证书都对
curl -i https://你的域名/api/auth/.well-known/openid-configuration
```

三处都返回 200 就通了。

## 只想要前端聊天

如果不需要登录和官方语音，这套后端完全不用起 —— 前端加一个第三方 provider 的 Key
就能对话，一行服务器代码都不用写。

## 出问题先看这几处

| 现象 | 原因 |
| --- | --- |
| 每个请求都 401 | `API_SERVER_URL`、`AUTH_SERVER_URL`、`PUBLIC_URL` 三者不一致 |
| docker 起不来，日志报扩展错误 | 数据库换成了宝塔自带的 PostgreSQL，必须用 compose 里的镜像 |
| 登录跳转 404 | nginx 少了 `/api/auth` 或 `/auth` 那两段反代 |
| 构建被 kill | 内存不足，加 swap 或换 4 GB 机器 |
