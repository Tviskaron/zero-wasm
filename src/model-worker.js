import * as ort from 'onnxruntime-web/wasm';
import { Tokenizer } from '@huggingface/tokenizers';
import { sample } from './sampling.js';

let session;
let tokenizer;
let manifest;
let activeId = null;
let cancelled = false;
let loading = false;
const threads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;
const siteRoot = new URL('../', import.meta.url);
ort.env.wasm.wasmPaths = new URL('vendor/ort/', siteRoot).href;
ort.env.wasm.numThreads = threads;
ort.env.wasm.proxy = false;

function status(message) { self.postMessage({ type: 'status', message }); }
function dispose(tensors) { for (const tensor of tensors) tensor?.dispose?.(); }

async function readJson(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Cannot download ${path} (HTTP ${response.status}).`);
  return response.json();
}

async function downloadModel(url, expectedBytes) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Model download failed (HTTP ${response.status}).`);
  if (!response.body?.getReader) return response.arrayBuffer();
  const reader = response.body.getReader();
  const chunks = [];
  // The manifest measures decoded bytes; HTTP Content-Length may be compressed.
  const total = expectedBytes || Number(response.headers.get('content-length'));
  let loaded = 0;
  let lastUpdate = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    const now = performance.now();
    if (now - lastUpdate > 100 || loaded === total) {
      self.postMessage({ type: 'download', loaded, total });
      lastUpdate = now;
    }
  }
  const bytes = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes.buffer;
}

async function load(model) {
  if (loading || activeId !== null) throw new Error('The model is busy. Stop generation before switching checkpoints.');
  loading = true;
  try {
    if (model !== 'ppo') throw new Error('Unknown checkpoint');
    status('Downloading checkpoint…');
    const root = new URL('assets/models/ppo/', siteRoot);
    const [metadata, tokenizerJson, tokenizerConfig] = await Promise.all([
      readJson(new URL('manifest.json', root)), readJson(new URL('tokenizer.json', root)), readJson(new URL('tokenizer_config.json', root)),
    ]);
    const bytes = await downloadModel(new URL('model.onnx', root), metadata.onnx_bytes);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const hash = Array.from(new Uint8Array(digest), (x) => x.toString(16).padStart(2, '0')).join('');
    if (hash !== metadata.onnx_sha256) throw new Error('The model download failed its integrity check. Reload the page and try Run again.');
    tokenizer = new Tokenizer(tokenizerJson, tokenizerConfig);
    // This vector was checked against the exact release's Rust tokenizer.
    const sanity = tokenizer.encode('Current observation:\nYou see a tree 2 steps north.\nResponse:\n', { add_special_tokens: false }).ids;
    if (JSON.stringify(sanity) !== '[558,482,28,201,322,387,263,415,366,293,335,16,201,671,28,201]') {
      throw new Error('Browser tokenizer differs from the published checkpoint tokenizer.');
    }
    status('Starting ONNX WebAssembly…');
    await session?.release();
    session = await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
    if (JSON.stringify(session.inputNames) !== JSON.stringify(metadata.input_names)) throw new Error('Unexpected ONNX input interface');
    manifest = metadata;
    self.postMessage({ type: 'ready', manifest, threads });
  } finally {
    loading = false;
  }
}

function publicPrompt(instructions, current, history) {
  const pieces = [instructions, '\nRecent history:'];
  for (const turn of history.slice(-4)) {
    pieces.push('Observation: ' + turn.text.long_term_context, 'Action: ' + turn.action);
  }
  pieces.push('\nCurrent observation:', current.long_term_context, current.short_term_context, '\nResponse:\n');
  return pieces.join('\n');
}

async function generate(message) {
  if (!session || !manifest || loading) throw new Error('Model is not ready');
  if (activeId !== null) throw new Error('Another response is still being generated');
  activeId = message.id;
  cancelled = false;
  const start = performance.now();
  const generated = [];
  let cache = Array.from({ length: manifest.layers * 2 }, () => new ort.Tensor('float32', new Float32Array(0), [1, manifest.kv_heads, 0, manifest.head_dim]));
  let output;
  let logits;
  let decodeStart;
  let capHit = false;
  let finished = false;
  try {
    const defaults = manifest.decoding_defaults;
    const cap = Math.max(1, Math.min(Number(message.maxNewTokens ?? defaults.max_new_tokens), manifest.max_new_tokens));
    if (!Number.isInteger(cap)) throw new Error('Response token cap must be an integer.');
    const temperature = Number(message.temperature ?? defaults.temperature);
    if (![0, 1].includes(temperature)) throw new Error('Unsupported sampling temperature');
    const samplingDraws = message.samplingDraws;
    if (temperature > 0) {
      if (!samplingDraws || !Number.isInteger(samplingDraws.length) || samplingDraws.length < cap) {
        throw new Error('Sampled generation requires the complete per-request PCG64 draw stream.');
      }
      for (let i = 0; i < cap; i += 1) {
        if (!Number.isFinite(samplingDraws[i]) || samplingDraws[i] < 0 || samplingDraws[i] >= 1) {
          throw new Error('Sampling draws must be finite and in [0, 1).');
        }
      }
    }
    const history = (message.history || []).slice(-4);
    let input;
    do {
      const prompt = publicPrompt(message.instructions, message.text, history);
      input = tokenizer.encode(prompt, { add_special_tokens: false }).ids;
      if (input.length + cap <= manifest.context_length) break;
      if (!history.length) throw new Error('Current observation and rules exceed the model context window.');
      history.shift();
    } while (true);

    async function forward(ids) {
      const tokenTensor = new ort.Tensor('int64', BigInt64Array.from(ids, BigInt), [1, ids.length]);
      const feeds = { input_ids: tokenTensor };
      for (let i = 0; i < manifest.layers; i += 1) {
        feeds[`past_key_${i}`] = cache[2 * i];
        feeds[`past_value_${i}`] = cache[2 * i + 1];
      }
      try {
        const next = await session.run(feeds);
        dispose(cache);
        cache = [];
        for (let i = 0; i < manifest.layers; i += 1) cache.push(next[`present_key_${i}`], next[`present_value_${i}`]);
        return next.logits;
      } finally {
        tokenTensor.dispose();
      }
    }

    const chunkSize = 128;
    for (let offset = 0; offset < input.length && !cancelled; offset += chunkSize) {
      logits?.dispose();
      logits = await forward(input.slice(offset, offset + chunkSize));
      self.postMessage({ type: 'prefill', id: activeId, completed: Math.min(offset + chunkSize, input.length), total: input.length });
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    decodeStart = performance.now();
    for (let i = 0; i < cap && !cancelled; i += 1) {
      const token = sample(logits.data, temperature, samplingDraws?.[i]);
      if (token === manifest.eos_token_id) { finished = true; break; }
      generated.push(token);
      if (i % 4 === 0 || i === cap - 1) {
        self.postMessage({ type: 'tokens', id: activeId, text: tokenizer.decode(generated, { skip_special_tokens: true, clean_up_tokenization_spaces: false }), tokens: generated.length, tokensPerSecond: generated.length / Math.max(.001, (performance.now() - decodeStart) / 1000) });
      }
      if (i === cap - 1) { capHit = true; break; }
      logits.dispose();
      logits = await forward([token]);
      // Give the cancel message an opportunity to interrupt the decode loop.
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    // Stop during prefill leaves no tokens, and the tokenizer rejects an empty decode.
    const text = generated.length ? tokenizer.decode(generated, { skip_special_tokens: true, clean_up_tokenization_spaces: false }) : '';
    output = { type: 'result', id: activeId, text, tokens: generated.length, seconds: (performance.now() - start) / 1000, cancelled, capHit: capHit && !finished, samplingSeed: message.samplingSeed ?? null };
  } finally {
    logits?.dispose();
    dispose(cache);
    activeId = null;
  }
  self.postMessage(output);
}

self.onmessage = ({ data }) => {
  if (data.type === 'cancel') {
    if (data.id === activeId) cancelled = true;
    return;
  }
  const task = data.type === 'load' ? load(data.model) : data.type === 'generate' ? generate(data) : Promise.reject(new Error('Unknown model command'));
  task.catch((error) => {
    self.postMessage({ type: 'error', id: data.id ?? null, message: error.stack || String(error) });
  });
};
