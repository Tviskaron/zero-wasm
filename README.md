# ZeroHero in Crafter

[Open the demo](https://tviskaron.github.io/zero-wasm/).

Crafter and small language agents running in the browser through WebAssembly.
The game is original Crafter 1.8.3. The demo opens with the 12.6M-parameter
[vision agent](#vision-agent), which plays from the game screen. The
5-million-parameter text agent (the published ZeroHero PPO iteration-300
checkpoint, on BALROG observations) is on `text.html`, or choose it under
**Agent** in the settings. There is no Python server, inference API, or training
code in this standalone repository.

## Run locally

Use Node.js 20 or newer:

```bash
npm ci
npm run build
npm start
```

Open <http://127.0.0.1:8787>. The build downloads the pinned runtime dependencies
and writes the static site to `dist/`; it does not train or evaluate a model.

Opening a page loads the Crafter WASM environment and that page's model in
parallel (vision agent 52 MiB, text agent 23.3 MiB). Both loading states and model
download progress appear on the game screen. Once ready, press **Run** to start the
agent or **Step** for one decision. Loading alone never starts play. Only the
page's own model is loaded. Game simulation and inference execute in browser workers. Use
**Stop** to pause, **Reset** for a new world, or arrow keys/WASD and Space for
manual movement and interaction.

Resetting the world keeps an in-progress model download. **Stop** can cancel
the download; **Run** retries a cancelled or failed load.

Demo episodes stop after 256 decisions, counting both agent and manual actions.
The game screen reports **Time limit reached** for this truncation and
**Game over** for an earlier natural ending. **New world** starts another episode
with a fresh seed and reuses the loaded model. This demo limit is separate from
the original model's evaluation horizon.

The settings button opens sampling controls, an adjustable delay between steps
(0.5 seconds by default), and optional token and reward stats. The current world
seed appears above the game; the initial seed is 0. Reasoning stays beside the
world and follows new text as the layout resizes. Inter is bundled locally.

Downloads use ordinary browser/HTTP caching. Persistent caching or offline
availability across reloads is not guaranteed. A modern browser with WASM and
SIMD support is required. GitHub Pages does not provide COOP/COEP isolation;
the hosted demo therefore uses the supported single-thread inference fallback.

## Vision agent

The default page (`index.html`; the old `vision.html` link redirects to it) runs
a 12.6M-parameter (12,593,280) Qwen3-VL screen student, initialized randomly,
trained to imitate Qwen Next's reasoning and actions, then with PPO. Each step
it sees only the 256×256 game screen and the line
`Accomplished achievements: …`; it gets no text observation and no history. It
writes its reasoning and a final `ACTION: <name>` line.

This checkpoint is at 2.65M environment steps. PPO first ran to 1.23M steps with
a reward of 1 per new achievement (the previous demo checkpoint), then continued
with Crafter's standard reward (also +0.1 per health point gained and -0.1 per
point lost) and 256-token answers; this is the continuation's best checkpoint on
the held-out worlds. On 128 fixed held-out worlds with 3 sampling seeds each
(temperature 1, 512-token answers) it scores 14.54 ± 0.13 achievements per game,
against 12.98 ± 0.15 for the 1.23M checkpoint on the same evaluation. The largest
gains are placing a furnace (49% to 81% of games), defeating a skeleton (52% to 65%)
and collecting iron (21% to 41%); it still almost never sleeps and does not make
iron tools. After PPO its reasoning is short and often empty. The model is two
ONNX graphs (vision encoder 29 MiB, decoder with KV cache 23.3 MiB) in
[`assets/models/vision-ppo/`](assets/models/vision-ppo/), whose manifest records
checksums, export checks and provenance; the page verifies both checksums before
loading. Sampling masks the four multimodal marker tokens, as in PPO training.
The default token limit is 512, as in the held-out evaluation.

## Deployment and provenance

The `main` branch contains the source, model assets, tests, and build workflow.
The `gh-pages` branch contains the compiled static site and a small deployment
entry point, with its own history. GitHub Actions runs `npm ci`, `npm test` and
`npm run build` on each push to `main`, commits the generated files to `gh-pages`,
and dispatches deployment from that branch. The deployment uploads that exact
commit to <https://tviskaron.github.io/zero-wasm/>. Edit `main`; the workflows
maintain `gh-pages` automatically. The `github-pages` environment permits the
`gh-pages` branch.

For the first deployment, open the repository's **Settings → Pages** and set
**Source** to **GitHub Actions**. Keep this setting. The stable deployment entry
point is bootstrapped with an authenticated Git push; regular builds reuse it
and call the deployment implementation on `main`. If the entry point changes,
run `npm run build` and `bash scripts/publish-pages.sh` locally with Git push
access before the next automated build. Preview the project URL locally with
`BASE_PATH=/zero-wasm/ npm start`.

The model comes from
[RLMM/zerohero-crafter-5m-ppo](https://huggingface.co/RLMM/zerohero-crafter-5m-ppo),
revision `6c8a3bf6884c814d19e521551f2b48ee3c20252c`. Its source-weight and ONNX
checksums, export checks, and decoding provenance are preserved in
[`assets/models/ppo/manifest.json`](assets/models/ppo/manifest.json). The page
checks the ONNX checksum before loading it. Game-source provenance is in
[`assets/world-provenance.json`](assets/world-provenance.json).

This is an interactive demo. Runtime arithmetic and game randomness can change
trajectories; it does not establish a new benchmark score. See
[third-party notices](THIRD_PARTY_NOTICES.md) and [component licenses](licenses/)
for source attribution and retained license texts.
