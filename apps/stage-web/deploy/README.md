# Deploy the Web App

This folder deploys the built `apps/stage-web` files as a static site. Two containers do the work:

- `web` serves the files with nginx.
- `caddy` holds the TLS certificate for your domain and sends all requests to `web`.

The site uses the official AIRI backend at `https://api.airi.build`. You can change the backend address at build time with `VITE_SERVER_URL`.

## Read this before you deploy

The official backend accepts browser requests from a short list of origins. Your own domain is not on the list. The lists are in `server/apps/api/src/utils/origin.ts` and in `server/apps/auth/src/origin.ts`.

These functions do not work from your domain:

- sign-in and cloud chat sync
- official speech, official chat, and Flux billing
- voice packs

These functions work from your domain:

- character cards and chat history in the browser
- third-party providers, for example DeepSeek
- local speech synthesis
- Live2D, VRM, and MMD models

Chat with a third-party provider needs no backend and no sign-in. The app keeps the provider key in the browser and calls the provider directly. Make sure that the provider accepts your origin. DeepSeek returns the request origin in `Access-Control-Allow-Origin`, so it works from any domain. A provider on plain HTTP does not work from an HTTPS page, because the browser blocks the request.

To get all functions, deploy the backend on the same domain. See `server/README.md`.

## Step 1: Remove the retrieval API key

WARNING: Do not build a public site with `VITE_KNOWLEDGE_BASE_API_KEY` set. Vite writes the value into the JavaScript bundle, and every visitor can read it.

`apps/stage-web/.env.local` holds this key on this machine. Move the file away before the build:

```powershell
Move-Item apps\stage-web\.env.local apps\stage-web\.env.local.dev
```

A shell variable is not sufficient. Vite gives `.env.local` priority over an existing `VITE_KNOWLEDGE_BASE_API_KEY` in the shell, so the build still writes the key into the bundle.

Move the file back after the build. To keep the retrieval function, send these requests through a server that holds the key. See `packages/stage-pages/src/pages/settings/knowledge-base/defaults.ts`.

## Step 2: Build the site

Run these commands at the repository root:

```sh
corepack enable
pnpm install
pnpm build:packages
pnpm -F @proj-airi/stage-web build
```

The build writes the site to `apps/stage-web/dist`.

Make sure that the bundle does not hold the key:

```powershell
Get-ChildItem apps\stage-web\dist -Recurse -File | Select-String -Pattern "<key>" -SimpleMatch -List
```

If the command prints a file name, remove the key from the environment and build again.

### Optional: add the documentation site and the UI stories

Run these commands before you copy the files:

```sh
pnpm -F @proj-airi/docs run build:base
mv ./docs/.vitepress/dist ./apps/stage-web/dist/docs
pnpm -F @proj-airi/stage-ui run story:build
mv ./packages/stage-ui/.histoire/dist ./apps/stage-web/dist/ui
```

`nginx.conf` serves both directories after this step.

## Step 3: Copy the files to the server

```sh
scp -r apps/stage-web/dist <user>@<server>:/srv/airi-web/
scp -r apps/stage-web/deploy <user>@<server>:/srv/airi-web/
```

`scp` keeps files on the server that the new build does not contain. Use `rsync` when you need an exact copy:

```sh
rsync -av --delete apps/stage-web/dist/ <user>@<server>:/srv/airi-web/dist/
```

The built site is about 385 MB. Source maps are about 64 MB of that size, and the server does not need them. Remove them before the copy:

```powershell
Get-ChildItem apps\stage-web\dist -Recurse -Filter *.map | Remove-Item
```

On Linux or macOS, use `find apps/stage-web/dist -name '*.map' -delete`. `nginx.conf` holds a commented rule that blocks source maps from the network instead.

## Step 4: Point the domain at the server

Add a DNS `A` record that maps your domain to the server IP address. Then wait for the record:

```sh
dig +short <your-domain>
```

## Step 5: Start the containers

On the server:

```sh
cd /srv/airi-web/deploy
cp .env.example .env
```

Open `.env` and set `AIRI_DOMAIN` to your domain. Then start the stack:

```sh
docker compose up -d
```

Make sure that ports 80 and 443 are free. Caddy asks Let's Encrypt for a certificate at the first request.

## Step 6: Make sure that the site works

1. Open `https://<your-domain>`. The onboarding page appears.
2. Make sure that the certificate is valid.
3. Speak into the microphone. The browser gives microphone access on HTTPS only.
4. Send a chat message through a third-party provider.

## Deploy a new version

Build the site again, then copy `dist` again:

```sh
scp -r apps/stage-web/dist <user>@<server>:/srv/airi-web/
```

nginx serves the new files immediately. A container restart is not necessary.

## Use an existing web server

If the server already runs nginx or Caddy on ports 80 and 443, do not start the `caddy` service.

1. Uncomment the `ports` entry of the `web` service in `docker-compose.yaml`.
2. Start only the `web` service:

```sh
docker compose up -d web
```

The service listens on `127.0.0.1:8080`. Point the existing edge to this address.

## Files in this folder

| File | Purpose |
| --- | --- |
| `nginx.conf` | Static file serving, SPA fallback, cache rules, compression |
| `Caddyfile` | Automatic TLS and reverse proxy to `web` |
| `docker-compose.yaml` | The `web` and `caddy` services |
| `.env.example` | Template for the domain name |
