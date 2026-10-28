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

function loadingStatus(kind, message, state = 'loading') {
  $(`${kind}-loading-detail`).textContent = message;
  $(`${kind}-loading-row`).dataset.state = state;
}

function controls() {
  const manualReady = worldReady && !busy && !autoplay && !world?.done;
  $('run').disabled = !manualReady || modelLoading;
  $('run').title = modelReady ? 'Run agent' : modelLoading ? 'Loading the default model' : 'Retry model and run agent';
  $('step').disabled = !manualReady || !modelReady;
  $('step').title = modelReady ? 'One agent step' : 'Waiting for the default model';
  $('stop').disabled = (!busy && !autoplay && !modelLoading) || resetting || pendingReset !== null;
  $('new-world').disabled = !worldReady || resetting || pendingReset !== null;
  $('restart').disabled = $('new-world').disabled;
  $('reset').disabled = !worldReady || resetting || pendingReset !== null || busy || autoplay;
  $('seed').disabled = busy || autoplay;
  $('temperature').disabled = busy || autoplay;
  $('token-limit').disabled = busy || autoplay;
  document.querySelectorAll('[data-action]').forEach((button) => { button.disabled = !manualReady; });
  $('manual-action').disabled = !manualReady;
  $('manual-go').disabled = !manualReady;
  const ended = Boolean(world?.done) && !resetting;
  $('world-loading').hidden = ended || (worldReady && !resetting && !modelLoading);
  $('world-loading').classList.toggle('has-world', worldReady);
  $('episode-end').hidden = !ended;
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
  loadingStatus('world', 'Ready', 'ready');
  $('world-seed').textContent = next.stats.seed;
  $('new-world').title = `New random world (current seed ${next.stats.seed})`;
  const inventory = next.stats.inventory || {};
  const vitals = [['health', 'Health'], ['food', 'Food'], ['drink', 'Drink'], ['energy', 'Energy']];
  $('vitals').replaceChildren(...vitals.map(([key, label]) => {
    const span = document.createElement('span');
    const value = document.createElement('b');
    value.textContent = inventory[key] ?? '?';
    span.append(`${label} `, value);
    return span;
  }));
  const achievements = Object.entries(next.stats.achievements || {}).filter(([, count]) => count > 0);
  $('readout').textContent = `Step ${next.stats.steps}/${next.episodeLimit ?? 256}, ${achievements.length}/22 achievements`;
  $('episode-end-title').textContent = next.truncated ? 'Time limit reached' : 'Game over';
  $('episode-end-detail').textContent = next.truncated
    ? `Episode ended by time: ${next.episodeLimit ?? 256} steps. ${achievements.length}/22 achievements.`
    : `Episode finished after ${next.stats.steps} steps. ${achievements.length}/22 achievements.`;
  $('achievement-count').textContent = `${achievements.length} of 22`;
  $('achievement-list').textContent = achievements.length ? achievements.map(([name]) => name.replaceAll('_', ' ')).join(', ') : 'None yet';
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
    $('action-note').textContent = `reward ${Number(next.reward).toFixed(2)}${next.invalid ? ', invalid output, used Noop' : ''}${next.done ? ', episode finished' : ''}`;
    $('action-note').title = $('action-note').textContent;
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
  $('thinking').querySelector('span').textContent = 'Processing the observation…';
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
    loadingStatus('world', data.message);
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
    // Pause after each applied action so the result stays readable before the next decision.
    if (autoplay) autoTimer = setTimeout(() => {
      autoTimer = null;
      if (autoplay) generate();
    }, Number($('step-delay').value));
  } else if (data.type === 'error') {
    busy = false;
    autoplay = false;
    resetting = false;
    pendingReset = null;
    loadingStatus('world', 'Game could not load. Reload to try again.', 'error');
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
  autoplay = false;
  $('thinking').hidden = true;
  $('model-detail').textContent = 'Download stopped. Press Run to try again.';
  loadingStatus('model', 'Stopped. Press Run to retry.', 'idle');
  $('model-loading-progress').hidden = true;
  $('token-stats').textContent = '';
  responseView.reset('Download stopped. Press Run to try again.');
}

function modelFailure(worker, message) {
  if (worker !== modelWorker) return;
  const failedDuringLoad = modelLoading;
  discardModelWorker();
  if (!failedDuringLoad) {
    busy = false;
    actionPending = false;
  }
  autoplay = false;
  clearTimeout(autoTimer);
  autoTimer = null;
  $('thinking').hidden = true;
  responseView.stopStreaming();
  $('model-detail').textContent = 'Load failed. Press Run to retry.';
  loadingStatus('model', 'Could not load. Press Run to retry.', 'error');
  $('model-loading-progress').hidden = true;
  notice(`Model: ${String(message).split('\n')[0]} Press Run to retry.`);
  if (pendingReset !== null && !applyingAction) startReset(pendingReset);
  else controls();
}

function loadDefaultModel() {
  if (modelReady || modelLoading) return;
  // Loading is independent of world initialization, resets, and agent playback.
  modelLoading = true;
  notice('');
  if (autoplay) responseView.reset('Loading the default model…');
  $('model-detail').textContent = 'Downloading model…';
  loadingStatus('model', 'Downloading the default PPO model…');
  $('model-loading-progress').hidden = true;
  $('model-loading-progress').removeAttribute('value');
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
    $('model-detail').textContent = data.message;
    loadingStatus('model', data.message);
  } else if (data.type === 'download') {
    const loaded = (data.loaded / 1048576).toFixed(1);
    const total = (data.total / 1048576).toFixed(1);
    $('model-detail').textContent = `Model · ${loaded} / ${total} MiB`;
    const progress = $('model-loading-progress');
    progress.hidden = false;
    if (data.total > 0) {
      const fraction = Math.min(1, data.loaded / data.total);
      progress.setAttribute('value', String(fraction));
      loadingStatus('model', `${Math.round(100 * fraction)}% · ${loaded} / ${total} MiB`);
    } else {
      progress.removeAttribute('value');
      loadingStatus('model', `${loaded} MiB downloaded`);
    }
  } else if (data.type === 'ready') {
    if (!modelLoading) return;
    modelLoading = false;
    modelReady = true;
    loadingStatus('model', 'Ready', 'ready');
    $('model-loading-progress').hidden = true;
    $('model-detail').textContent = `${data.manifest.label}, FP32, 5,033,600 parameters, ${data.threads} thread${data.threads === 1 ? '' : 's'}`;
    controls();
    if (autoplay) generate();
  } else if (data.id !== null && data.id !== requestId) {
    return;
  } else if (data.type === 'prefill') {
    if (!actionPending || pendingReset !== null) return;
    $('token-stats').textContent = `Reading ${data.completed} / ${data.total} prompt tokens`;
  } else if (data.type === 'tokens') {
    if (!actionPending || pendingReset !== null) return;
    responseView.append(data.text);
    $('token-stats').textContent = `${data.tokens} tokens, ${data.tokensPerSecond.toFixed(1)} tok/s`;
    $('thinking').hidden = true;
  } else if (data.type === 'result') {
    if (!actionPending) return;
    $('thinking').hidden = true;
    actionPending = false;
    if (pendingReset !== null) {
      startReset(pendingReset);
      return;
    }
    responseView.finish(data.text || (data.cancelled ? 'Generation stopped.' : 'Empty model response.'));
    $('token-stats').textContent = `${data.tokens} tokens in ${(data.seconds).toFixed(1)}s${data.capHit ? ', token limit reached' : ''}`;
    if (data.cancelled || stopRequested) {
      busy = false;
      autoplay = false;
      controls();
      return;
    }
    const parsed = data.text.replace(/[^a-zA-Z\s:]/g, '').split('ACTION:').at(-1).trim();
    const action = world.actions.includes(parsed) ? parsed : 'Noop';
    $('last-action').textContent = action;
    if (action !== parsed) $('action-note').textContent = 'No valid action in response, fallback to Noop';
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
    loadingStatus('world', 'Game could not load. Reload to try again.', 'error');
    if (!modelReady) loadingStatus('model', 'Stopped', 'idle');
    worldReady = false;
    resetting = false;
    responseView.stopStreaming();
    pendingReset = null;
    notice(`Crafter: ${event.message}. Reload the page to try again.`);
    controls();
};

$('run').onclick = () => {
  if (!worldReady || busy || autoplay || resetting || modelLoading || world.done) return;
  autoplay = true;
  if (!modelReady) loadDefaultModel();
  else generate();
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
  loadingStatus('world', `New world, seed ${seed}`);
  $('world-seed').textContent = seed;
  $('world-loading').hidden = false;
  $('last-action').textContent = 'none';
  $('readout').textContent = 'Creating a new world…';
  responseView.reset('New world created. Press Run to start the agent.');
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
    $('thinking').querySelector('span').textContent = 'Creating a new world…';
    $('thinking').hidden = false;
  } else {
    startReset(seed);
  }
  controls();
}

$('reset').onclick = () => requestReset(Number($('seed').value));
$('show-stats').onchange = () => {
  $('token-stats').hidden = !$('show-stats').checked;
  $('action-footer').hidden = !$('show-stats').checked;
};
$('new-world').onclick = $('restart').onclick = () => {
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
const drawer = document.querySelector('.drawer');
document.addEventListener('pointerdown', (event) => {
  if (drawer.open && !drawer.contains(event.target)) drawer.open = false;
});
drawer.addEventListener('toggle', () => {
  if (drawer.open) drawer.querySelector('.drawer-content').scrollIntoView({ block: 'nearest' });
});
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && drawer.open) {
    drawer.open = false;
    drawer.querySelector('summary').focus();
    return;
  }
  if (['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON', 'SUMMARY'].includes(document.activeElement?.tagName) || event.ctrlKey || event.metaKey || event.altKey) return;
  const action = { ArrowUp: 'Move North', ArrowDown: 'Move South', ArrowLeft: 'Move West', ArrowRight: 'Move East', w: 'Move North', s: 'Move South', a: 'Move West', d: 'Move East', ' ': 'Do' }[event.key];
  if (action && worldReady) { event.preventDefault(); manualAction(action); }
});
worldWorker.postMessage({ type: 'init', seed: Number($('seed').value) });
loadDefaultModel();
controls();
