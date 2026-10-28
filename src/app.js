import { ResponseView } from './response-view.js';

const $ = (id) => document.getElementById(id);
const responseView = new ResponseView($('response'), document.querySelector('.response-wrap'));
const worldWorker = new Worker(new URL('./world-worker.js', import.meta.url), { type: 'module' });
let modelWorker = null;
let world = null;
let modelReady = false;
let worldReady = false;
let busy = false;
let autoplay = false;
let requestId = 0;
let actionPending = false;
let applyingAction = false;
let modelLoading = false;
let stopRequested = false;
let pendingReset = null;
let resetting = false;
let autoTimer = null;

function notice(message) {
  $('notice').textContent = message;
  $('notice').hidden = !message;
}

function controls() {
  const manualReady = worldReady && !busy && !autoplay && !world?.done;
  $('run').disabled = !manualReady;
  $('run').title = modelReady ? 'Run agent' : 'Download model and run agent';
  $('step').disabled = !manualReady || !modelReady;
  $('step').title = modelReady ? 'One agent step' : 'Press Run first to load the model';
  $('stop').disabled = (!busy && !autoplay) || resetting || pendingReset !== null;
  $('new-world').disabled = !worldReady || resetting || pendingReset !== null;
  $('reset').disabled = !worldReady || resetting || pendingReset !== null || ((busy || autoplay) && !modelLoading);
  $('seed').disabled = (busy || autoplay) && !modelLoading;
  $('temperature').disabled = busy || autoplay;
  $('token-limit').disabled = busy || autoplay;
  document.querySelectorAll('[data-action]').forEach((button) => { button.disabled = !manualReady; });
  $('manual-action').disabled = !manualReady;
  $('manual-go').disabled = !manualReady;
  $('run').textContent = '▶';
}

function draw(frame) {
  if (!frame) return;
  const canvas = $('world');
  canvas.width = frame.width;
  canvas.height = frame.height;
  const context = canvas.getContext('2d');
  context.putImageData(new ImageData(new Uint8ClampedArray(frame.rgba), frame.width, frame.height), 0, 0);
}

function renderWorld(next) {
  world = next;
  worldReady = true;
  draw(next.frame);
  $('world-loading').hidden = true;
  $('world-status').textContent = next.done ? 'Episode finished' : 'WASM · ready';
  $('world-status').className = 'status ready';
  $('world-seed').textContent = `SEED ${next.stats.seed}`;
  $('new-world').title = `New random world · current seed ${next.stats.seed}`;
  $('world-step').textContent = `STEP ${next.stats.steps}`;
  const inventory = next.stats.inventory || {};
  const vitals = [['♥', 'health', 'Health'], ['◆', 'food', 'Food'], ['◈', 'drink', 'Drink'], ['✦', 'energy', 'Energy']];
  $('vitals').replaceChildren(...vitals.map(([icon, key, label]) => {
    const span = document.createElement('span');
    span.append(document.createTextNode(`${icon} `));
    const value = document.createElement('b');
    value.textContent = inventory[key] ?? '—';
    const small = document.createElement('small');
    small.textContent = label;
    span.append(value, small);
    return span;
  }));
  const achievements = Object.entries(next.stats.achievements || {}).filter(([, count]) => count > 0);
  $('achievement-count').innerHTML = `${achievements.length} <small>/ 22</small>`;
  $('achievement-list').replaceChildren();
  if (!achievements.length) $('achievement-list').textContent = 'Explore the world to unlock achievements.';
  for (const [name] of achievements) {
    const chip = document.createElement('span');
    chip.className = 'achievement-pill';
    chip.textContent = name.replaceAll('_', ' ');
    $('achievement-list').append(chip);
  }
  $('observation').textContent = `${next.text.long_term_context}\n${next.text.short_term_context}`;
  if (!$('manual-action').options.length) {
    for (const action of next.actions) {
      const option = document.createElement('option');
      option.value = action;
      option.textContent = action;
      $('manual-action').append(option);
    }
    $('manual-action').value = 'Sleep';
  }
  if (next.action) {
    $('last-action').textContent = next.action;
    $('action-note').textContent = `Step ${next.stats.steps} · reward ${Number(next.reward).toFixed(2)}${next.invalid ? ' · invalid output defaulted to Noop' : ''}${next.done ? ' · episode finished' : ''}`;
  }
}

function manualAction(action) {
  if (!worldReady || busy || autoplay || world.done) return;
  busy = true;
  applyingAction = true;
  responseView.reset('Manual control.');
  $('token-stats').textContent = 'Human action';
  controls();
  worldWorker.postMessage({ type: 'step', action });
}

function generate() {
  if (!worldReady || !modelReady || busy || world.done) return;
  busy = true;
  actionPending = true;
  applyingAction = false;
  stopRequested = false;
  requestId += 1;
  notice('');
  responseView.begin();
  $('thinking').hidden = false;
  $('thinking').querySelector('span').textContent = 'Reading the world…';
  $('token-stats').textContent = 'Tokenizing observation…';
  modelWorker.postMessage({
    type: 'generate', id: requestId, instructions: world.instructions,
    text: world.text, history: world.history || [], prompt: world.prompt,
    maxNewTokens: Number($('token-limit').value), temperature: Number($('temperature').value),
    samplingSeed: world.sampling.seed, samplingDraws: world.sampling.draws,
  });
  controls();
}

worldWorker.onmessage = ({ data }) => {
  if (data.type === 'status') {
    $('world-loading-detail').textContent = data.message;
    $('world-status').textContent = data.message;
  } else if (data.type === 'world') {
    if (pendingReset !== null) {
      startReset(pendingReset);
      return;
    }
    renderWorld(data);
    resetting = false;
    busy = false;
    applyingAction = false;
    if (data.done) autoplay = false;
    controls();
    if (autoplay) autoTimer = setTimeout(() => {
      autoTimer = null;
      if (autoplay) generate();
    }, 150);
  } else if (data.type === 'error') {
    busy = false;
    autoplay = false;
    resetting = false;
    pendingReset = null;
    $('world-status').textContent = 'Game error';
    $('world-loading-detail').textContent = data.message;
    $('thinking').hidden = true;
    responseView.stopStreaming();
    notice(`Crafter: ${data.message}`);
    controls();
  }
};

function discardModelWorker() {
  const worker = modelWorker;
  modelWorker = null;
  modelReady = false;
  modelLoading = false;
  if (worker) {
    worker.onmessage = null;
    worker.onerror = null;
    worker.terminate();
  }
}

function stopModelLoading() {
  discardModelWorker();
  busy = false;
  autoplay = false;
  actionPending = false;
  $('thinking').hidden = true;
  $('model-status').textContent = 'Loads on ▶';
  $('model-status').className = 'status';
  $('token-stats').textContent = '';
  responseView.reset('Download stopped. Press ▶ to try again.');
}

function modelFailure(worker, message) {
  if (worker !== modelWorker) return;
  discardModelWorker();
  busy = false;
  actionPending = false;
  autoplay = false;
  clearTimeout(autoTimer);
  autoTimer = null;
  $('thinking').hidden = true;
  responseView.stopStreaming();
  $('model-status').textContent = 'Load failed · press ▶';
  $('model-status').className = 'status';
  notice(`Model: ${String(message).split('\n')[0]} Press ▶ to retry.`);
  if (pendingReset !== null) startReset(pendingReset);
  else controls();
}

function loadModelForRun() {
  // Creating this worker imports the tokenizer and ONNX code, so this function
  // is called exclusively by an explicit click on the Run button.
  modelLoading = true;
  busy = true;
  autoplay = true;
  notice('');
  responseView.reset('Downloading the model…');
  $('model-status').textContent = 'Downloading model…';
  $('model-status').className = 'status';
  $('token-stats').textContent = 'Preparing 23.3 MiB checkpoint…';
  $('thinking').hidden = false;
  $('thinking').querySelector('span').textContent = 'Loading the agent…';
  controls();
  try {
    const worker = new Worker(new URL('./model-worker.js', import.meta.url), { type: 'module' });
    modelWorker = worker;
    worker.onmessage = ({ data }) => handleModelMessage(worker, data);
    worker.onerror = (event) => modelFailure(worker, event.message);
    worker.postMessage({ type: 'load', model: 'ppo' });
  } catch (error) {
    modelFailure(modelWorker, error.message);
  }
}

function handleModelMessage(worker, data) {
  // A stopped download can still have messages queued on the main thread.
  if (worker !== modelWorker) return;
  if (data.type === 'status') {
    $('model-status').textContent = data.message;
  } else if (data.type === 'download') {
    const loaded = (data.loaded / 1048576).toFixed(1);
    const total = (data.total / 1048576).toFixed(1);
    $('model-status').textContent = `Model · ${loaded} / ${total} MiB`;
    $('token-stats').textContent = `Downloading model · ${Math.round(100 * data.loaded / data.total)}%`;
  } else if (data.type === 'ready') {
    if (!modelLoading) return;
    modelLoading = false;
    modelReady = true;
    busy = false;
    $('thinking').hidden = true;
    $('model-status').textContent = `WASM · ${data.threads} thread${data.threads === 1 ? '' : 's'}`;
    $('model-status').className = 'status ready';
    $('model-detail').textContent = `${data.manifest.label} · FP32 · 5,033,600 parameters`;
    controls();
    if (autoplay) generate();
  } else if (data.id !== null && data.id !== requestId) {
    return;
  } else if (data.type === 'prefill') {
    if (!actionPending || pendingReset !== null) return;
    $('token-stats').textContent = `Reading ${data.completed} / ${data.total} prompt tokens`;
    $('thinking').querySelector('span').textContent = 'Encoding the observation and recent history…';
  } else if (data.type === 'tokens') {
    if (!actionPending || pendingReset !== null) return;
    responseView.append(data.text);
    $('token-stats').textContent = `${data.tokens} tokens · ${data.tokensPerSecond.toFixed(1)} tok/s`;
    $('thinking').querySelector('span').textContent = 'Generating the next action…';
  } else if (data.type === 'result') {
    if (!actionPending) return;
    $('thinking').hidden = true;
    actionPending = false;
    if (pendingReset !== null) {
      startReset(pendingReset);
      return;
    }
    responseView.finish(data.text || (data.cancelled ? 'Generation stopped.' : 'Empty model response.'));
    $('token-stats').textContent = `${data.tokens} tokens · ${(data.seconds).toFixed(1)}s${data.capHit ? ' · token limit reached' : ''}`;
    if (data.cancelled || stopRequested) {
      busy = false;
      autoplay = false;
      controls();
      return;
    }
    const parsed = data.text.replace(/[^a-zA-Z\s:]/g, '').split('ACTION:').at(-1).trim();
    const action = world.actions.includes(parsed) ? parsed : 'Noop';
    $('last-action').textContent = action;
    if (action !== parsed) $('action-note').textContent = 'No valid action in response · fallback to Noop';
    applyingAction = true;
    worldWorker.postMessage({ type: 'step', action: parsed });
  } else if (data.type === 'error') {
    modelFailure(worker, data.message);
  }
}

worldWorker.onerror = (event) => {
    busy = false;
    autoplay = false;
    actionPending = false;
    if (modelLoading) discardModelWorker();
    worldReady = false;
    resetting = false;
    responseView.stopStreaming();
    pendingReset = null;
    notice(`Crafter: ${event.message}. Reload the page to try again.`);
    controls();
};

$('run').onclick = () => {
  if (!worldReady || busy || autoplay || resetting || world.done) return;
  if (!modelReady) loadModelForRun();
  else { autoplay = true; generate(); }
};
$('step').onclick = generate;
$('stop').onclick = () => {
  autoplay = false;
  clearTimeout(autoTimer);
  autoTimer = null;
  if (modelLoading) stopModelLoading();
  else if (busy && actionPending && !applyingAction) {
    stopRequested = true;
    modelWorker.postMessage({ type: 'cancel', id: requestId });
  }
  controls();
};
function startReset(seed) {
  if (modelLoading) stopModelLoading();
  pendingReset = null;
  resetting = true;
  busy = true;
  autoplay = false;
  actionPending = false;
  applyingAction = false;
  requestId += 1;
  clearTimeout(autoTimer);
  autoTimer = null;
  notice('');
  $('seed').value = String(seed);
  $('world-status').textContent = 'Generating world…';
  $('world-loading-detail').textContent = `New world · seed ${seed}`;
  $('world-loading').hidden = false;
  $('last-action').textContent = '—';
  $('world-step').textContent = 'NEW WORLD';
  responseView.reset('A fresh world. Press ▶ to explore.');
  $('thinking').hidden = true;
  $('action-note').textContent = '';
  $('token-stats').textContent = '';
  worldWorker.postMessage({ type: 'reset', seed });
  controls();
}

function requestReset(seed) {
  if (!worldReady || resetting || pendingReset !== null) return;
  if (!Number.isInteger(seed) || seed < 0 || seed > 2147483647) {
    notice('Choose an integer world seed between 0 and 2,147,483,647.');
    return;
  }
  autoplay = false;
  clearTimeout(autoTimer);
  autoTimer = null;
  if (busy && (actionPending || applyingAction)) {
    pendingReset = seed;
    if (actionPending) modelWorker.postMessage({ type: 'cancel', id: requestId });
    $('thinking').querySelector('span').textContent = 'Starting a fresh world…';
  } else {
    startReset(seed);
  }
  controls();
}

$('reset').onclick = () => requestReset(Number($('seed').value));
$('new-world').onclick = () => {
  const random = new Uint32Array(1);
  let seed;
  do { seed = crypto.getRandomValues(random)[0] & 0x7fffffff; }
  while (seed === world?.stats.seed);
  requestReset(seed);
};
document.querySelectorAll('[data-action]').forEach((button) => {
  button.onclick = () => manualAction(button.dataset.action);
});
$('manual-go').onclick = () => manualAction($('manual-action').value);
window.addEventListener('keydown', (event) => {
  if (['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(document.activeElement?.tagName) || event.ctrlKey || event.metaKey || event.altKey) return;
  const action = { ArrowUp: 'Move North', ArrowDown: 'Move South', ArrowLeft: 'Move West', ArrowRight: 'Move East', w: 'Move North', s: 'Move South', a: 'Move West', d: 'Move East', ' ': 'Do' }[event.key];
  if (action && worldReady) { event.preventDefault(); manualAction(action); }
});
worldWorker.postMessage({ type: 'init', seed: Number($('seed').value) });
controls();
