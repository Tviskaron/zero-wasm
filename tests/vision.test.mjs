import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { parseHTML } from 'linkedom';
import { ResponseView } from '../src/response-view.js';

globalThis.ResizeObserver = class { observe() {} };

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const source = (await readFile(new URL('../src/app.js', import.meta.url), 'utf8'))
  .replace("import { ResponseView } from './response-view.js';", '')
  .replaceAll('import.meta.url', JSON.stringify('https://tviskaron.github.io/zero-wasm/built/app.js'));

function boot() {
  const { window, document } = parseHTML(html);
  const workers = [];
  for (const select of document.querySelectorAll('select')) {
    let value = select.querySelector('option[selected]')?.value || select.querySelector('option')?.value || '';
    Object.defineProperty(select, 'value', { get: () => value, set: (next) => { value = String(next); } });
  }
  document.getElementById('world').getContext = () => ({ putImageData() {} });
  class FakeWorker {
    constructor(url) { this.url = url.href; this.messages = []; workers.push(this); }
    postMessage(message) { this.messages.push(message); }
    terminate() {}
    emit(data) { this.onmessage?.({ data }); }
  }
  vm.runInNewContext(source, {
    document, window, Worker: FakeWorker, ResponseView, URL, Uint32Array, ImageData: class {},
    crypto: { getRandomValues(array) { array[0] = 7; return array; } },
    fetch() { throw new Error('Unexpected fetch from the page'); },
    setTimeout() { return 1; }, clearTimeout() {},
  });
  return { document, workers, get: (id) => document.getElementById(id) };
}

test('the vision page loads the vision worker and sends the screen with the achievements line', () => {
  const ui = boot();
  const [world, model] = ui.workers;
  assert.equal(model.url, 'https://tviskaron.github.io/zero-wasm/built/vision-worker.js');
  assert.equal(model.messages[0].type, 'load');
  assert.equal(model.messages[0].model, 'vision-ppo');
  const frame = { rgba: new ArrayBuffer(256 * 256 * 4), width: 256, height: 256 };
  world.emit({
    type: 'world', done: false, action: null, reward: 0, frame,
    text: { long_term_context: 'unused', short_term_context: 'unused' }, history: [], instructions: '', prompt: '',
    actions: ['Noop', 'Move East'], stats: { seed: 0, steps: 0, inventory: {}, achievements: { place_table: 1, collect_wood: 2, eat_cow: 0 } },
    sampling: { seed: 1, draws: new Float64Array(1024).fill(0.5) },
  });
  model.emit({ type: 'ready', threads: 1, manifest: { label: 'Vision PPO', parameters: 12593280 } });
  assert.match(ui.get('model-detail').textContent, /Vision PPO, FP32, 12,593,280 parameters/);
  ui.get('step').onclick();
  const request = model.messages.find((message) => message.type === 'generate');
  assert.equal(request.accomplished, 'Accomplished achievements: collect_wood, place_table');
  assert.equal(request.frame, frame);
  assert.equal(request.maxNewTokens, 512);
  assert.equal(request.instructions, undefined);
});

test('vision assets match their manifest and the page uses relative paths', async () => {
  const manifest = JSON.parse(await readFile(new URL('../assets/models/vision-ppo/manifest.json', import.meta.url), 'utf8'));
  for (const [name, key] of [['vision.onnx', 'vision'], ['decoder.onnx', 'decoder']]) {
    const bytes = await readFile(new URL(`../assets/models/vision-ppo/${name}`, import.meta.url));
    assert.equal(bytes.length, manifest[`${key}_bytes`]);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), manifest[`${key}_sha256`]);
  }
  const { document } = parseHTML(html);
  assert.equal(document.querySelector('script[type="module"]').getAttribute('src'), './built/app.js');
  assert.equal(document.querySelector('link[rel="stylesheet"]').getAttribute('href'), './styles.css');
});
