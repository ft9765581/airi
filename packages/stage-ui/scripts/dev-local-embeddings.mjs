import process from 'node:process'

/**
 * Development-only embeddings service for the intent comparison page.
 *
 * The deployment has no embedding endpoint: the chat providers only serve chat
 * models. This script hosts a small Chinese sentence-embedding model in Node and
 * exposes it as an OpenAI-compatible `/v1/embeddings` route, so the devtools page
 * can compare embedding classification against the generative classifier without
 * any infrastructure or key.
 *
 * It is not part of any build. Start it, then point the page at
 * `http://127.0.0.1:5178/v1`.
 *
 * Call stack:
 *
 * pnpm -F @proj-airi/stage-ui exec node scripts/dev-local-embeddings.mjs
 *   -> createServer (node:http)
 *     -> handleEmbeddings
 *       -> loadExtractor
 *         -> pipeline('feature-extraction', model)
 *
 * Environment:
 *
 * - `PORT` sets the listen port. Defaults to 5178.
 * - `EMBEDDING_MODEL` sets the model loaded on the first request. Defaults to
 *   `Xenova/bge-small-zh-v1.5`.
 * - `HF_MIRROR` sets the model host. Hugging Face itself may be unreachable from
 *   the local network, so the mirror is the default.
 * - `TRANSFORMERS_CACHE` sets the download cache. Defaults to `.tmp/transformers`.
 */
import { Buffer } from 'node:buffer'
import { createServer } from 'node:http'

import { env, pipeline } from '@huggingface/transformers'

const port = Number(process.env.PORT ?? 5178)
const defaultModel = process.env.EMBEDDING_MODEL ?? 'Xenova/bge-small-zh-v1.5'
const mirror = process.env.HF_MIRROR ?? 'https://hf-mirror.com'

// The cache lives outside the repository's package folders so a model download
// never lands in a build artifact or a dependency folder.
env.cacheDir = process.env.TRANSFORMERS_CACHE ?? '.tmp/transformers'
env.allowLocalModels = false
env.remoteHost = mirror

/** Loaded models, keyed by id. Loading one model takes about two minutes cold. */
const extractors = new Map()

function loadExtractor(model) {
  const cached = extractors.get(model)
  if (cached)
    return cached

  const loading = pipeline('feature-extraction', model, { dtype: 'fp32' })
  extractors.set(model, loading)
  return loading
}

async function embed(model, inputs) {
  const extractor = await loadExtractor(model)
  const output = await extractor(inputs, { normalize: true, pooling: 'mean' })
  const dims = output.dims.at(-1)
  const flat = output.tolist()

  return flat.map(vector => Array.from(vector).slice(0, dims))
}

function json(response, status, body) {
  const payload = JSON.stringify(body)
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  })
  response.end(payload)
}

async function readBody(request) {
  const chunks = []
  for await (const chunk of request)
    chunks.push(chunk)

  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
}

const server = createServer(async (request, response) => {
  if (request.method === 'OPTIONS') {
    response.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    })
    response.end()
    return
  }

  if (request.method === 'GET' && request.url === '/health') {
    json(response, 200, { ok: true, models: [...extractors.keys()], mirror })
    return
  }

  if (request.method === 'GET' && request.url === '/v1/models') {
    json(response, 200, {
      object: 'list',
      data: [{ id: defaultModel, object: 'model', owned_by: 'local-transformers' }],
    })
    return
  }

  if (request.method !== 'POST' || request.url !== '/v1/embeddings') {
    json(response, 404, { error: { message: 'Not found' } })
    return
  }

  try {
    const body = await readBody(request)
    const model = typeof body.model === 'string' && body.model ? body.model : defaultModel
    const inputs = Array.isArray(body.input) ? body.input : [body.input]

    if (!inputs.length || inputs.some(input => typeof input !== 'string')) {
      json(response, 400, { error: { message: '`input` must be a string or an array of strings' } })
      return
    }

    const startedAt = Date.now()
    const vectors = await embed(model, inputs)

    console.info(`[embed] ${inputs.length} inputs, ${vectors[0]?.length ?? 0} dims, ${Date.now() - startedAt}ms, model ${model}`)

    json(response, 200, {
      object: 'list',
      model,
      data: vectors.map((embedding, index) => ({ object: 'embedding', index, embedding })),
      usage: { prompt_tokens: 0, total_tokens: 0 },
    })
  }
  catch (error) {
    console.error('[embed] failed:', error)
    json(response, 500, { error: { message: String(error?.message ?? error) } })
  }
})

server.listen(port, '127.0.0.1', () => {
  console.info(`[embed] listening on http://127.0.0.1:${port}/v1 (model ${defaultModel}, mirror ${mirror})`)
  console.info('[embed] the first request downloads the model; it takes about two minutes')
})
