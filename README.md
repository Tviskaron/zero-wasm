# ZeroHero 5M in Crafter

[Open the demo](https://tviskaron.github.io/zero-wasm/).

Crafter and a 5-million-parameter language agent running in the browser through
WebAssembly. The game uses original Crafter 1.8.3 with BALROG observations; the
agent uses the published ZeroHero PPO iteration-300 checkpoint. There is no
Python server, inference API, or training code in this standalone repository.

## Run locally

Use Node.js 20 or newer:

```bash
npm ci
npm run build
npm start
```

Open <http://127.0.0.1:8787>. The build downloads the pinned runtime dependencies
and writes the static site to `dist/`; it does not train or evaluate a model.

Opening the page loads the Crafter WASM environment and the default PPO ONNX
model (23.3 MiB) in parallel. Both loading states and model download progress
appear on the game screen. Once ready, press **Run** to start the agent or
**Step** for one decision. Loading alone never starts play. Only the default
PPO checkpoint is preloaded. Game simulation and inference execute in browser workers. Use
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

`vision.html` (or **Agent** in the settings) runs a second agent on the same game:
a 12.6M-parameter (12,593,280) Qwen3-VL screen student, initialized randomly,
trained to imitate Qwen Next's reasoning and actions, then with PPO. Each step
it sees only the 256×256 game screen and the line
`Accomplished achievements: …`; it gets no text observation and no history. It
writes its reasoning and a final `ACTION: <name>` line. This checkpoint is the
best PPO checkpoint at 1.23M environment steps. On 128 fixed held-out worlds
(temperature 1) it scores 13.19 achievements per game, against 6.39 before PPO
(its 100-episode training mean was 12.69 when it was selected). Training it
further, to 2.06M and 5.86M steps, scored lower on the same worlds (12.30 and
11.85). After PPO its reasoning is short and often empty. The model is two
ONNX graphs (vision encoder 29 MiB, decoder with KV cache 23.3 MiB) in
[`assets/models/vision-ppo/`](assets/models/vision-ppo/), whose manifest records
checksums, export checks and provenance; the page verifies both checksums before
loading. Sampling masks the four multimodal marker tokens, as in PPO training.
The default token limit is 512, the PPO training cap.

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
