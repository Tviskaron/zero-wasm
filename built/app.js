// src/response-view.js
var ResponseView = class {
  constructor(element, container) {
    this.element = element;
    this.container = container;
    this.document = element.ownerDocument;
    this.text = "";
    this.follow = true;
    this.onScroll = () => {
      this.follow = this.atBottom();
    };
    container.addEventListener("scroll", this.onScroll, { passive: true });
    new ResizeObserver(() => {
      if (this.follow) container.scrollTop = container.scrollHeight;
    }).observe(container);
  }
  atBottom() {
    return this.container.scrollHeight - this.container.clientHeight - this.container.scrollTop < 28;
  }
  update(render) {
    const follow = this.follow || this.atBottom();
    const position = this.container.scrollTop;
    render();
    this.container.scrollTop = follow ? this.container.scrollHeight : position;
    this.follow = follow;
  }
  begin() {
    this.text = "";
    this.follow = true;
    this.element.replaceChildren();
    this.element.classList.add("active", "response-streaming");
    this.container.classList.add("is-streaming");
    this.container.scrollTop = 0;
  }
  append(fullText) {
    const next = String(fullText ?? "");
    if (next === this.text) return;
    this.update(() => {
      let common = 0;
      const limit = Math.min(this.text.length, next.length);
      while (common < limit && this.text[common] === next[common]) common += 1;
      if (common && /[\uD800-\uDBFF]/.test(next[common - 1])) common -= 1;
      if (common < this.text.length) this.truncate(common);
      const addition = next.slice(common);
      if (addition) {
        const span = this.document.createElement("span");
        span.className = "response-stream-segment";
        span.textContent = addition;
        this.element.append(span);
      }
      this.text = next;
    });
  }
  truncate(length) {
    let remaining = length;
    for (const child of [...this.element.childNodes]) {
      const size = child.textContent.length;
      if (remaining >= size) {
        remaining -= size;
      } else if (remaining > 0) {
        child.textContent = child.textContent.slice(0, remaining);
        remaining = 0;
      } else {
        child.remove();
      }
    }
  }
  appendInline(parent, text) {
    let position = 0;
    for (const match of text.matchAll(/\*\*([^*\n]+)\*\*/g)) {
      parent.append(this.document.createTextNode(text.slice(position, match.index)));
      const strong = this.document.createElement("strong");
      strong.textContent = match[1];
      parent.append(strong);
      position = match.index + match[0].length;
    }
    parent.append(this.document.createTextNode(text.slice(position)));
  }
  finish(fullText) {
    this.update(() => {
      this.text = String(fullText ?? "");
      const fragment = this.document.createDocumentFragment();
      for (const text of this.text.split("\n")) {
        const line = this.document.createElement("span");
        line.className = "response-line";
        const bullet = text.match(/^(\s*)([-*]|\d+[.)])\s+(.*)$/);
        if (bullet) {
          line.classList.add("response-list-item");
          const marker = this.document.createElement("span");
          marker.className = "response-list-marker";
          marker.textContent = `${bullet[1]}${bullet[2]} `;
          line.append(marker);
          this.appendInline(line, bullet[3]);
        } else {
          this.appendInline(line, text);
        }
        if (/^\s*(?:\*\*)?ACTION\s*:/i.test(text)) line.classList.add("response-action-line");
        fragment.append(line);
      }
      this.element.replaceChildren(fragment);
      this.stopStreaming();
    });
  }
  reset(text) {
    this.text = String(text ?? "");
    this.follow = true;
    this.element.textContent = this.text;
    this.element.classList.remove("active");
    this.stopStreaming();
    this.container.scrollTop = 0;
  }
  stopStreaming() {
    this.element.classList.remove("response-streaming");
    this.container.classList.remove("is-streaming");
  }
};

// src/app.js
var $ = (id) => document.getElementById(id);
var responseView = new ResponseView($("response"), document.querySelector(".response-wrap"));
var worldWorker = new Worker(new URL("./world-worker.js", import.meta.url), { type: "module" });
var modelWorker = null;
var world = null;
var modelReady = false;
var worldReady = false;
var busy = false;
var autoplay = false;
var requestId = 0;
var actionPending = false;
var applyingAction = false;
var modelLoading = false;
var stopRequested = false;
var pendingReset = null;
var resetting = false;
var autoTimer = null;
function notice(message) {
  $("notice").textContent = message;
  $("notice").hidden = !message;
}
function controls() {
  const manualReady = worldReady && !busy && !autoplay && !world?.done;
  $("run").disabled = !manualReady;
  $("run").title = modelReady ? "Run agent" : "Download model and run agent";
  $("step").disabled = !manualReady || !modelReady;
  $("step").title = modelReady ? "One agent step" : "Press Run first to load the model";
  $("stop").disabled = !busy && !autoplay || resetting || pendingReset !== null;
  $("new-world").disabled = !worldReady || resetting || pendingReset !== null;
  $("reset").disabled = !worldReady || resetting || pendingReset !== null || (busy || autoplay) && !modelLoading;
  $("seed").disabled = (busy || autoplay) && !modelLoading;
  $("temperature").disabled = busy || autoplay;
  $("token-limit").disabled = busy || autoplay;
  document.querySelectorAll("[data-action]").forEach((button) => {
    button.disabled = !manualReady;
  });
  $("manual-action").disabled = !manualReady;
  $("manual-go").disabled = !manualReady;
}
function draw(frame) {
  if (!frame) return;
  const canvas = $("world");
  canvas.width = frame.width;
  canvas.height = frame.height;
  const context = canvas.getContext("2d");
  context.putImageData(new ImageData(new Uint8ClampedArray(frame.rgba), frame.width, frame.height), 0, 0);
}
function renderWorld(next) {
  world = next;
  worldReady = true;
  draw(next.frame);
  $("world-loading").hidden = true;
  $("world-seed").textContent = next.stats.seed;
  $("new-world").title = `New random world (current seed ${next.stats.seed})`;
  const inventory = next.stats.inventory || {};
  const vitals = [["health", "Health"], ["food", "Food"], ["drink", "Drink"], ["energy", "Energy"]];
  $("vitals").replaceChildren(...vitals.map(([key, label]) => {
    const span = document.createElement("span");
    const value = document.createElement("b");
    value.textContent = inventory[key] ?? "?";
    span.append(`${label} `, value);
    return span;
  }));
  const achievements = Object.entries(next.stats.achievements || {}).filter(([, count]) => count > 0);
  $("readout").textContent = `Step ${next.stats.steps}, ${achievements.length}/22 achievements${next.done ? ", episode finished" : ""}`;
  $("achievement-count").textContent = `${achievements.length} of 22`;
  $("achievement-list").textContent = achievements.length ? achievements.map(([name]) => name.replaceAll("_", " ")).join(", ") : "None yet";
  $("observation").textContent = `${next.text.long_term_context}
${next.text.short_term_context}`;
  if (!$("manual-action").options.length) {
    for (const action of next.actions) {
      const option = document.createElement("option");
      option.value = action;
      option.textContent = action;
      $("manual-action").append(option);
    }
    $("manual-action").value = "Sleep";
  }
  if (next.action) {
    $("last-action").textContent = next.action;
    $("action-note").textContent = `reward ${Number(next.reward).toFixed(2)}${next.invalid ? ", invalid output, used Noop" : ""}${next.done ? ", episode finished" : ""}`;
    $("action-note").title = $("action-note").textContent;
  }
}
function manualAction(action) {
  if (!worldReady || busy || autoplay || world.done) return;
  busy = true;
  applyingAction = true;
  responseView.reset("Manual control.");
  $("token-stats").textContent = "Human action";
  controls();
  worldWorker.postMessage({ type: "step", action });
}
function generate() {
  if (!worldReady || !modelReady || busy || world.done) return;
  busy = true;
  actionPending = true;
  applyingAction = false;
  stopRequested = false;
  requestId += 1;
  notice("");
  responseView.begin();
  $("thinking").hidden = false;
  $("thinking").querySelector("span").textContent = "Processing the observation\u2026";
  $("token-stats").textContent = "Tokenizing observation\u2026";
  modelWorker.postMessage({
    type: "generate",
    id: requestId,
    instructions: world.instructions,
    text: world.text,
    history: world.history || [],
    prompt: world.prompt,
    maxNewTokens: Number($("token-limit").value),
    temperature: Number($("temperature").value),
    samplingSeed: world.sampling.seed,
    samplingDraws: world.sampling.draws
  });
  controls();
}
worldWorker.onmessage = ({ data }) => {
  if (data.type === "status") {
    $("world-loading-detail").textContent = data.message;
  } else if (data.type === "world") {
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
    }, Number($("step-delay").value));
  } else if (data.type === "error") {
    busy = false;
    autoplay = false;
    resetting = false;
    pendingReset = null;
    $("world-loading-detail").textContent = data.message;
    $("thinking").hidden = true;
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
  $("thinking").hidden = true;
  $("model-detail").textContent = "Download stopped. Press Run to try again.";
  $("token-stats").textContent = "";
  responseView.reset("Download stopped. Press Run to try again.");
}
function modelFailure(worker, message) {
  if (worker !== modelWorker) return;
  discardModelWorker();
  busy = false;
  actionPending = false;
  autoplay = false;
  clearTimeout(autoTimer);
  autoTimer = null;
  $("thinking").hidden = true;
  responseView.stopStreaming();
  $("model-detail").textContent = "Load failed. Press Run to retry.";
  notice(`Model: ${String(message).split("\n")[0]} Press Run to retry.`);
  if (pendingReset !== null) startReset(pendingReset);
  else controls();
}
function loadModelForRun() {
  modelLoading = true;
  busy = true;
  autoplay = true;
  notice("");
  responseView.reset("Downloading the model\u2026");
  $("model-detail").textContent = "Downloading model\u2026";
  $("token-stats").textContent = "Preparing 23.3 MiB checkpoint\u2026";
  $("thinking").hidden = false;
  $("thinking").querySelector("span").textContent = "Loading the agent\u2026";
  controls();
  try {
    const worker = new Worker(new URL("./model-worker.js", import.meta.url), { type: "module" });
    modelWorker = worker;
    worker.onmessage = ({ data }) => handleModelMessage(worker, data);
    worker.onerror = (event) => modelFailure(worker, event.message);
    worker.postMessage({ type: "load", model: "ppo" });
  } catch (error) {
    modelFailure(modelWorker, error.message);
  }
}
function handleModelMessage(worker, data) {
  if (worker !== modelWorker) return;
  if (data.type === "status") {
    $("model-detail").textContent = data.message;
    if (modelLoading) $("thinking").querySelector("span").textContent = data.message;
  } else if (data.type === "download") {
    const loaded = (data.loaded / 1048576).toFixed(1);
    const total = (data.total / 1048576).toFixed(1);
    $("model-detail").textContent = `Model \xB7 ${loaded} / ${total} MiB`;
    $("token-stats").textContent = `Downloading model \xB7 ${Math.round(100 * data.loaded / data.total)}%`;
    $("thinking").querySelector("span").textContent = $("token-stats").textContent;
  } else if (data.type === "ready") {
    if (!modelLoading) return;
    modelLoading = false;
    modelReady = true;
    busy = false;
    $("thinking").hidden = true;
    $("model-detail").textContent = `${data.manifest.label}, FP32, 5,033,600 parameters, ${data.threads} thread${data.threads === 1 ? "" : "s"}`;
    controls();
    if (autoplay) generate();
  } else if (data.id !== null && data.id !== requestId) {
    return;
  } else if (data.type === "prefill") {
    if (!actionPending || pendingReset !== null) return;
    $("token-stats").textContent = `Reading ${data.completed} / ${data.total} prompt tokens`;
  } else if (data.type === "tokens") {
    if (!actionPending || pendingReset !== null) return;
    responseView.append(data.text);
    $("token-stats").textContent = `${data.tokens} tokens, ${data.tokensPerSecond.toFixed(1)} tok/s`;
    $("thinking").hidden = true;
  } else if (data.type === "result") {
    if (!actionPending) return;
    $("thinking").hidden = true;
    actionPending = false;
    if (pendingReset !== null) {
      startReset(pendingReset);
      return;
    }
    responseView.finish(data.text || (data.cancelled ? "Generation stopped." : "Empty model response."));
    $("token-stats").textContent = `${data.tokens} tokens in ${data.seconds.toFixed(1)}s${data.capHit ? ", token limit reached" : ""}`;
    if (data.cancelled || stopRequested) {
      busy = false;
      autoplay = false;
      controls();
      return;
    }
    const parsed = data.text.replace(/[^a-zA-Z\s:]/g, "").split("ACTION:").at(-1).trim();
    const action = world.actions.includes(parsed) ? parsed : "Noop";
    $("last-action").textContent = action;
    if (action !== parsed) $("action-note").textContent = "No valid action in response, fallback to Noop";
    applyingAction = true;
    worldWorker.postMessage({ type: "step", action: parsed });
  } else if (data.type === "error") {
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
$("run").onclick = () => {
  if (!worldReady || busy || autoplay || resetting || world.done) return;
  if (!modelReady) loadModelForRun();
  else {
    autoplay = true;
    generate();
  }
};
$("step").onclick = generate;
$("stop").onclick = () => {
  autoplay = false;
  clearTimeout(autoTimer);
  autoTimer = null;
  if (modelLoading) stopModelLoading();
  else if (busy && actionPending && !applyingAction) {
    stopRequested = true;
    modelWorker.postMessage({ type: "cancel", id: requestId });
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
  notice("");
  $("seed").value = String(seed);
  $("world-loading-detail").textContent = `New world, seed ${seed}`;
  $("world-seed").textContent = seed;
  $("world-loading").hidden = false;
  $("last-action").textContent = "none";
  $("readout").textContent = "Creating a new world\u2026";
  responseView.reset("New world created. Press Run to start the agent.");
  $("thinking").hidden = true;
  $("action-note").textContent = "";
  $("token-stats").textContent = "";
  worldWorker.postMessage({ type: "reset", seed });
  controls();
}
function requestReset(seed) {
  if (!worldReady || resetting || pendingReset !== null) return;
  if (!Number.isInteger(seed) || seed < 0 || seed > 2147483647) {
    notice("Choose an integer world seed between 0 and 2,147,483,647.");
    return;
  }
  autoplay = false;
  clearTimeout(autoTimer);
  autoTimer = null;
  if (busy && (actionPending || applyingAction)) {
    pendingReset = seed;
    if (actionPending) modelWorker.postMessage({ type: "cancel", id: requestId });
    $("thinking").querySelector("span").textContent = "Creating a new world\u2026";
    $("thinking").hidden = false;
  } else {
    startReset(seed);
  }
  controls();
}
$("reset").onclick = () => requestReset(Number($("seed").value));
$("show-stats").onchange = () => {
  $("token-stats").hidden = !$("show-stats").checked;
  $("action-footer").hidden = !$("show-stats").checked;
};
$("new-world").onclick = () => {
  const random = new Uint32Array(1);
  let seed;
  do {
    seed = crypto.getRandomValues(random)[0] & 2147483647;
  } while (seed === world?.stats.seed);
  requestReset(seed);
};
document.querySelectorAll("[data-action]").forEach((button) => {
  button.onclick = () => manualAction(button.dataset.action);
});
$("manual-go").onclick = () => manualAction($("manual-action").value);
var drawer = document.querySelector(".drawer");
document.addEventListener("pointerdown", (event) => {
  if (drawer.open && !drawer.contains(event.target)) drawer.open = false;
});
drawer.addEventListener("toggle", () => {
  if (drawer.open) drawer.querySelector(".drawer-content").scrollIntoView({ block: "nearest" });
});
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && drawer.open) {
    drawer.open = false;
    drawer.querySelector("summary").focus();
    return;
  }
  if (["INPUT", "SELECT", "TEXTAREA", "BUTTON", "SUMMARY"].includes(document.activeElement?.tagName) || event.ctrlKey || event.metaKey || event.altKey) return;
  const action = { ArrowUp: "Move North", ArrowDown: "Move South", ArrowLeft: "Move West", ArrowRight: "Move East", w: "Move North", s: "Move South", a: "Move West", d: "Move East", " ": "Do" }[event.key];
  if (action && worldReady) {
    event.preventDefault();
    manualAction(action);
  }
});
worldWorker.postMessage({ type: "init", seed: Number($("seed").value) });
controls();
