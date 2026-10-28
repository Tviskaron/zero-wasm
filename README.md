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

Downloads use ordinary browser/HTTP caching. Persistent caching or offline
availability across reloads is not guaranteed. A modern browser with WASM and
SIMD support is required. GitHub Pages does not provide COOP/COEP isolation;
the hosted demo therefore uses the supported single-thread inference fallback.

## Deployment and provenance

The `codex/github-pages` branch contains the standalone site. GitHub Actions
runs `npm ci`, `npm test` and `npm run build`, then publishes `dist/` to
<https://tviskaron.github.io/zero-wasm/>.

For the first deployment, open the repository's **Settings → Pages** and set
**Source** to **GitHub Actions**. Subsequent pushes to the dedicated branch
deploy automatically. Preview the project URL locally with
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
