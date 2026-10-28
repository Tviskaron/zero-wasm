# zero-wasm

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

Opening the page initializes the Crafter WASM environment. Press **Run** to
download the PPO ONNX model (23.3 MiB) and inference WASM runtime, then let the
agent play. Game simulation and inference execute in browser workers. Use
**Stop** to pause, **Reset** for a new world, or arrow keys/WASD and Space for
manual movement and interaction.

The settings button opens sampling controls, an adjustable delay between steps
(0.5 seconds by default), and optional token and reward stats. The current world
seed appears above the game; the initial seed is 0. Reasoning stays beside the
world and follows new text as the layout resizes. Inter is bundled locally.

Downloads use ordinary browser/HTTP caching. Persistent caching or offline
availability across reloads is not guaranteed. A modern browser with WASM and
SIMD support is required. GitHub Pages does not provide COOP/COEP isolation;
the hosted demo therefore uses the supported single-thread inference fallback.

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
