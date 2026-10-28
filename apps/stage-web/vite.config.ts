import type { Plugin } from 'vite'

import process, { cwd, env } from 'node:process'

import { Buffer } from 'node:buffer'
import { execSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

import VueI18n from '@intlify/unplugin-vue-i18n/vite'
import templateCompilerOptions from '@tresjs/core/template-compiler-options'
import Vue from '@vitejs/plugin-vue'
import Unocss from 'unocss/vite'
import Basemove, { createS3Provider } from 'unplugin-basemove/vite'
import Info from 'unplugin-info/vite'
import Yaml from 'unplugin-yaml/vite'
import Mkcert from 'vite-plugin-mkcert'
import VueDevTools from 'vite-plugin-vue-devtools'
import Layouts from 'vite-plugin-vue-layouts'
import VueMacros from 'vue-macros/vite'
import VueRouter from 'vue-router/vite'

import { tryCatch } from '@moeru/std'
import { Download } from '@proj-airi/unplugin-fetch/vite'
import { DownloadLive2DSDK } from '@proj-airi/unplugin-live2d-sdk/vite'
import { LFS, SpaceCard } from 'hfup/vite'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

const stageUIAssetsRoot = resolve(join(import.meta.dirname, '..', '..', 'packages', 'stage-ui', 'src', 'assets'))
const sharedCacheDir = resolve(join(import.meta.dirname, '..', '..', '.cache'))

/**
 * Answers the shared runtime endpoint while `vite dev` runs.
 *
 * The settings page publishes deployment settings through
 * `/api/v1/shared-runtime`, which the API serves. A plain `pnpm dev` has no API,
 * so the page would sit in "administrator only" forever. This plugin keeps one
 * JSON file under `.cache/` and answers both methods, so publish and apply can
 * be exercised without Docker or a sign-in. It never runs in a build.
 *
 * Removal condition: when the local backend is part of the standard dev flow.
 */
function devSharedRuntime(): Plugin {
  const file = resolve(join(sharedCacheDir, 'dev-shared-runtime.json'))

  function read(): { settings: unknown, updatedAt: string | null } {
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as { settings?: unknown, updatedAt?: string }
      return { settings: parsed.settings ?? null, updatedAt: parsed.updatedAt ?? null }
    }
    catch {
      // No file yet, or a hand-edited one: an empty deployment is a valid state.
      return { settings: null, updatedAt: null }
    }
  }

  return {
    name: 'airi:dev-shared-runtime',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/api/v1/shared-runtime', (request, response) => {
        if (request.method === 'GET') {
          const { settings, updatedAt } = read()
          response.setHeader('Content-Type', 'application/json')
          response.end(JSON.stringify({ settings, updatedAt, canEdit: true }))
          return
        }

        if (request.method !== 'PUT') {
          response.statusCode = 405
          response.end()
          return
        }

        const chunks: Buffer[] = []
        request.on('data', (chunk: Buffer) => chunks.push(chunk))
        request.on('end', () => {
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
            const savedAt = new Date().toISOString()
            mkdirSync(dirname(file), { recursive: true })
            writeFileSync(file, JSON.stringify({ settings: body, updatedAt: savedAt }, null, 2), 'utf8')
            response.setHeader('Content-Type', 'application/json')
            response.end(JSON.stringify({ settings: body, updatedAt: savedAt, canEdit: true }))
          }
          catch {
            response.statusCode = 400
            response.setHeader('Content-Type', 'application/json')
            response.end(JSON.stringify({ error: 'INVALID_REQUEST' }))
          }
        })
      })
    },
  }
}

function hasFlagEnableMkcert(): boolean {
  if (process.argv.includes('--mkcert')) {
    return true
  }
  if (env.STAGE_WEB_ENABLE_MKCERT === 'true') {
    return true
  }

  return false
}

export default defineConfig({
  optimizeDeps: {
    exclude: [
      // Internal Packages
      '@proj-airi/stage-ui/*',
      '@proj-airi/drizzle-duckdb-wasm',
      '@proj-airi/drizzle-duckdb-wasm/*',

      // Static Assets: Models, Images, etc.
      'public/assets/*',

      // Live2D SDK
      '@framework/live2dcubismframework',
      '@framework/math/cubismmatrix44',
      '@framework/type/csmvector',
      '@framework/math/cubismviewmatrix',
      '@framework/cubismdefaultparameterid',
      '@framework/cubismmodelsettingjson',
      '@framework/effect/cubismbreath',
      '@framework/effect/cubismeyeblink',
      '@framework/model/cubismusermodel',
      '@framework/motion/acubismmotion',
      '@framework/motion/cubismmotionqueuemanager',
      '@framework/type/csmmap',
      '@framework/utils/cubismdebug',
      '@framework/model/cubismmoc',
    ],
  },
  resolve: {
    alias: {
      '@proj-airi/server-sdk': resolve(join(import.meta.dirname, '..', '..', 'packages', 'server-sdk', 'src')),
      '@proj-airi/i18n': resolve(join(import.meta.dirname, '..', '..', 'packages', 'i18n', 'src')),
      '@proj-airi/stage-ui': resolve(join(import.meta.dirname, '..', '..', 'packages', 'stage-ui', 'src')),
      '@proj-airi/stage-pages': resolve(join(import.meta.dirname, '..', '..', 'packages', 'stage-pages', 'src')),
      '@proj-airi/stage-shared': resolve(join(import.meta.dirname, '..', '..', 'packages', 'stage-shared', 'src')),
      '@proj-airi/stage-layouts': resolve(join(import.meta.dirname, '..', '..', 'packages', 'stage-layouts', 'src')),
    },
  },
  server: {
    fs: {
      // To mute errors like:
      //   The request id ".../node_modules/@fontsource/sniglet/files/sniglet-latin-400-normal.woff" is outside of Vite serving allow list.
      //
      // See: https://vite.dev/config/server-options#server-fs-strict
      strict: false,
    },
    watch: {
      // NOTICE:
      // Agent and editor tooling writes files atomically: it creates `.<name>.<pid>.<uuid>.tmpdir/<name>.tmp`
      // beside the target file, then renames it into place. Chokidar descends into that temporary
      // directory and watches the temp file. Windows then raises
      // `EBUSY: resource busy or locked, watch '<...>.tmpdir/<name>.tmp'` when the temp file is
      // removed, and Vite exits because nothing handles the watcher's `error` event.
      // Observed on 2026-10-14: pid 18712 wrote `apps/stage-web/index.html` and killed `vite --host`.
      // Ignore the temporary directories so a concurrent writer cannot crash the dev server.
      // Observed again on 2026-10-23: a deploy package being written to `apps/stage-web/dist-<date>.zip`
      // raised the same error, because the watcher descends into the app directory and the archive is
      // still open while it is written. A browser never loads a zip as a module in dev, so ignoring the
      // extension costs nothing and stops a package build from killing the server.
      // Removal condition: only when file writers stop creating temp directories or archives inside the project tree.
      ignored: ['**/.*.tmpdir', '**/.*.tmpdir/**', '**/*.zip'],
    },
    warmup: {
      clientFiles: [
        `${resolve(join(import.meta.dirname, '..', '..', 'packages', 'stage-ui', 'src'))}/*.vue`,
        `${resolve(join(import.meta.dirname, '..', '..', 'packages', 'stage-pages', 'src'))}/*.vue`,
      ],
    },
  },
  build: {
    manifest: true,
    rolldownOptions: {
      output: {
        chunkFileNames: (chunkInfo) => {
          const containsAnalyticsModule = chunkInfo.moduleIds.some((moduleId) => {
            const normalizedModuleId = moduleId.replaceAll('\\', '/').toLowerCase()
            return normalizedModuleId.includes('analytics') || normalizedModuleId.includes('posthog')
          })

          // Only analytics/provider chunks receive the manual neutral mapping;
          // all unrelated chunks retain Vite's readable default naming.
          return containsAnalyticsModule
            ? 'assets/auxiliary-[hash].js'
            : 'assets/[name]-[hash].js'
        },
      },
    },
    // Source maps never reach a browser request, and they dominate the upload
    // size. A debugging build sets `VITE_BUILD_SOURCEMAP=1` to get them back.
    sourcemap: env.VITE_BUILD_SOURCEMAP === '1',
  },
  worker: {
    format: 'es',
    rollupOptions: {
      output: {
        inlineDynamicImports: false,
      },
    },
  },

  plugins: [
    ...(
      hasFlagEnableMkcert()
        ? [Mkcert((() => {
            // Workaround: plugin's bundled downloader has a feaxios bug, prefer system mkcert
            const command = process.platform === 'win32' ? 'where' : 'which'

            const { data } = tryCatch(() => ({ mkcertPath: execSync(`${command} mkcert`, { stdio: 'pipe' }).toString().trim().split(/\r?\n/)[0] }))
            return data
          })())]
        : []
    ),

    Info(),

    Yaml(),

    devSharedRuntime(),

    VueMacros({
      plugins: {
        vue: Vue({
          include: [/\.vue$/, /\.md$/],
          ...templateCompilerOptions,
        }),
        vueJsx: false,
      },
      betterDefine: false,
    }),

    VueRouter({
      extensions: ['.vue', '.md'],
      dts: resolve(import.meta.dirname, 'src/typed-router.d.ts'),
      importMode: 'async',
      routesFolder: [
        resolve(import.meta.dirname, 'src', 'pages'),
        resolve(import.meta.dirname, '..', '..', 'packages', 'stage-pages', 'src', 'pages'),
      ],
      exclude: ['**/components/**'],
    }),

    // https://github.com/JohnCampionJr/vite-plugin-vue-layouts
    Layouts({
      layoutsDirs: [
        resolve(import.meta.dirname, 'src', 'layouts'),
        resolve(import.meta.dirname, '..', '..', 'packages', 'stage-layouts', 'src', 'layouts'),
      ],
    }),

    // https://github.com/antfu/unocss
    // see uno.config.ts for config
    Unocss(),

    // https://github.com/antfu/vite-plugin-pwa
    // NOTICE:
    // The plugin must stay registered in dev — `src/modules/pwa.ts` imports
    // the `virtual:pwa-register` module the plugin synthesises, and dropping
    // the plugin breaks Vite's import-analysis with a "Failed to resolve
    // import" error.
    // SW generation in dev is already disabled by `devOptions.enabled:
    // false` (the plugin's own default). So new SWs do NOT register from
    // `pnpm dev` alone — but a previously-registered SW (e.g. from an
    // earlier `vite preview` / `vite build`) lives on per-origin in the
    // browser and keeps intercepting fetches even in dev. To recover from
    // that state, unregister via DevTools → Application → Storage → Clear
    // site data.
    ...(env.TARGET_HUGGINGFACE_SPACE
      ? []
      : [VitePWA({
          // `autoUpdate` installs, activates and takes control of open tabs by
          // itself, so a visitor never has to answer an update prompt. The
          // previous `prompt` mode left the old worker in charge: it answered
          // navigations to `/auth/sign-in` from the precached `index.html`,
          // which broke login until the user pressed the update toast.
          //
          // `selfDestroying` is deliberately NOT used here: it reloads open tabs
          // on activation, and this app registers the worker again on every
          // load, which would reload in a loop.
          registerType: 'autoUpdate',
          includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
          manifest: {
            name: '清锡医疗',
            short_name: '清锡医疗',
            description: '产后访视护士助手',
            lang: 'zh-Hans',
            icons: [
              {
                src: '/web-app-manifest-192x192.png',
                sizes: '192x192',
                type: 'image/png',
              },
              {
                src: '/web-app-manifest-512x512.png',
                sizes: '512x512',
                type: 'image/png',
              },
              {
                purpose: 'maskable',
                sizes: '192x192',
                src: '/maskable_icon_x192.png',
                type: 'image/png',
              },
              {
                purpose: 'maskable',
                sizes: '512x512',
                src: '/maskable_icon_x512.png',
                type: 'image/png',
              },
            ],
          },
          workbox: {
            maximumFileSizeToCacheInBytes: 64 * 1024 * 1024,
            // A path listed here is never answered from the precached
            // `index.html`; the browser must ask the server.
            //
            // `/auth/` is required: `/auth/sign-in` is a server-side hop that
            // answers 302 to the sign-in page. Without the entry the active
            // service worker served `index.html` for that navigation, so the
            // app router rendered its catch-all ("Where are we?") instead of
            // following the redirect, and login could never finish.
            navigateFallbackDenylist: [
              /^\/docs\//,
              /^\/ui\//,
              /^\/auth\//,
              /^\/remote-assets\//,
              /^\/api\//,
              /^\/internal\//,
            ],
          },
        })]),

    // https://github.com/intlify/bundle-tools/tree/main/packages/unplugin-vue-i18n
    VueI18n({
      runtimeOnly: true,
      compositionOnly: true,
      fullInstall: true,
    }),

    // https://github.com/webfansplz/vite-plugin-vue-devtools
    VueDevTools(),

    DownloadLive2DSDK(),
    Download('https://dist.ayaka.moe/live2d-models/hiyori_free_zh.zip', 'hiyori_free_zh.zip', 'live2d/models', { parentDir: stageUIAssetsRoot, cacheDir: sharedCacheDir }),
    Download('https://dist.ayaka.moe/live2d-models/hiyori_pro_zh.zip', 'hiyori_pro_zh.zip', 'live2d/models', { parentDir: stageUIAssetsRoot, cacheDir: sharedCacheDir }),
    Download('https://dist.ayaka.moe/vrm-models/VRoid-Hub/AvatarSample-A/AvatarSample_A.vrm', 'AvatarSample_A.vrm', 'vrm/models/AvatarSample-A', { parentDir: stageUIAssetsRoot, cacheDir: sharedCacheDir }),
    Download('https://dist.ayaka.moe/vrm-models/VRoid-Hub/AvatarSample-B/AvatarSample_B.vrm', 'AvatarSample_B.vrm', 'vrm/models/AvatarSample-B', { parentDir: stageUIAssetsRoot, cacheDir: sharedCacheDir }),

    // HuggingFace Spaces
    LFS({ root: cwd(), extraGlobs: [
      // Scene & Models
      '*.vrm',
      '*.vrma',
      '*.hdr',
      '*.cmo3',
      // Images & Fonts
      '*.png',
      '*.jpg',
      '*.jpeg',
      '*.gif',
      '*.webp',
      '*.bmp',
      '*.ttf',
      '*.avif',
      // Tensorflow / MediaPipe task
      '*.task',
    ] }),
    SpaceCard({
      root: cwd(),
      title: 'AIRI: Virtual Companion',
      emoji: '🧸',
      colorFrom: 'pink',
      colorTo: 'pink',
      sdk: 'static',
      pinned: false,
      license: 'mit',
      models: [
        'onnx-community/whisper-base',
        'onnx-community/silero-vad',
      ],
      short_description: 'AI driven VTuber & Companion, supports Live2D and VRM.',
    }),

    // For the following example assets:
    //
    // dist/assets/ort-wasm-simd-threaded.jsep-B0T3yYHD.wasm                21,596.01 kB │ gzip: 5,121.95 kB
    // dist/assets/XiaolaiSC-Regular-SNWuh554.ttf                           22,183.94 kB
    // dist/assets/cjkFonts_allseto_v1.11-ByBdljxl.ttf                      31,337.14 kB
    // dist/assets/duckdb-coi-CSr8FQO4.wasm                                 32,320.49 kB │ gzip: 7,194.65 kB
    // dist/assets/duckdb-eh-BJOC5S4x.wasm                                  32,604.02 kB │ gzip: 7,133.37 kB
    // dist/assets/duckdb-mvp-8HYqhb4i.wasm                                 37,345.64 kB │ gzip: 8,099.69 kB
    //
    // they are too large to be able to put into deployments like Cloudflare Workers or Pages,
    // we need to upload them to external storage and use renderBuiltUrl to rewrite their URLs.
    ...((!env.S3_ENDPOINT || !env.S3_ACCESS_KEY_ID || !env.S3_SECRET_ACCESS_KEY)
      ? []
      : [
          Basemove({
            prefix: env.STAGE_WEB_WARP_DRIVE_PREFIX || 'proj-airi/stage-web/main/',
            include: [/\.wasm$/i, /\.ttf$/i, /\.vrm$/i, /\.zip$/i], // in existing assets, wasm, ttf, vrm files are the largest ones
            manifest: true,
            clean: false,
            contentTypeBy: (filename: string) => {
              if (filename.endsWith('.wasm')) {
                return 'application/wasm'
              }
              if (filename.endsWith('.ttf')) {
                return 'font/ttf'
              }
              if (filename.endsWith('.vrm')) {
                return 'application/octet-stream'
              }
              if (filename.endsWith('.zip')) {
                return 'application/zip'
              }
            },
            provider: createS3Provider({
              endpoint: env.S3_ENDPOINT,
              accessKeyId: env.S3_ACCESS_KEY_ID,
              secretAccessKey: env.S3_SECRET_ACCESS_KEY,
              region: env.S3_REGION,
              publicBaseUrl: env.WARP_DRIVE_PUBLIC_BASE ?? env.S3_ENDPOINT,
            }),
          }),
        ]),
  ],
})
