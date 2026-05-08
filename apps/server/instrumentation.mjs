/**
 * OTEL instrumentation preload — loaded via `--import` BEFORE tsx processes
 * any application module. This ensures @opentelemetry/instrumentation-pg can
 * monkey-patch the CJS `pg` module before it is imported anywhere.
 *
 * Only instrumentations that patch third-party modules need to live here.
 * The full SDK (exporters, metrics, log processors) is still configured in
 * src/libs/otel.ts — the NodeSDK there will reuse the already-registered
 * instrumentations.
 *
 * NOTICE: `pg` and `ioredis` are CJS packages. When ESM code does
 * `import pg from 'pg'`, Node.js internally calls `require()` to load
 * the CJS module, so `require-in-the-middle` hooks still intercept it.
 */

import { env } from 'node:process'

import { registerInstrumentations } from '@opentelemetry/instrumentation'
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http'
import { IORedisInstrumentation } from '@opentelemetry/instrumentation-ioredis'
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg'

// NOTICE:
// instrumentation-http >=0.215 defaults to OLD semconv (http.server.duration in
// ms). Our Grafana dashboards / alerts only query the STABLE name
// (http.server.request.duration in seconds), and grep across the repo confirms
// no OLD-name consumer exists, so we go straight to STABLE-only — no `http/dup`
// transition phase, no doubled cardinality.
// Source: node_modules/.pnpm/@opentelemetry+instrumentation-http@0.215.0/.../build/src/http.js L25-72
// MUST run before `new HttpInstrumentation(...)` below — its constructor reads
// the env var once and caches the result.
// Removal condition: ops sets OTEL_SEMCONV_STABILITY_OPT_IN explicitly in the
// deployment platform (Railway env), then this preload default can be deleted.
env.OTEL_SEMCONV_STABILITY_OPT_IN ??= 'http'

registerInstrumentations({
  instrumentations: [
    new HttpInstrumentation({
      ignoreIncomingRequestHook: req => req.url === '/health',
    }),
    new PgInstrumentation({
      enhancedDatabaseReporting: true,
    }),
    new IORedisInstrumentation(),
  ],
})
