# ZeroHero in Crafter

[Play in your browser](https://tviskaron.github.io/zero-wasm/)

ZeroHero is a 12.6M-parameter Qwen3-VL agent trained to play Crafter. It sees the 256×256 game screen, the achievements it has earned and a short memory it wrote on the previous turn. The game runs in a Pyodide worker and the model runs locally through ONNX Runtime Web. The page downloads about 52 MiB of model weights.

Press **Step** for one decision or **Run** for continuous play. The response shows the agent’s reasoning, action and updated memory. You can pause with **Stop**, choose a world seed under settings or play manually with WASD, the arrow keys and Space. Browser episodes end at death or 512 steps.

## Model and evaluation

The released actor has **874,037,248 PPO environment steps**. It averaged **19.27 of 22 distinct achievements per episode** in the native CUDA evaluation. We compared the previous release (125,681,664 steps, 19.02), the checkpoint selected by training reward (874,037,248 steps, 19.27) and a recent milestone (916,766,720 steps, 18.62) on the same 128 held-out worlds, each played with three sampling seeds. All three used FP32, temperature 1, a 512-token answer limit and a 2,000-step episode limit. These scores come from the GPU evaluator. Browser runs use a shorter horizon and WebAssembly inference.

The agent was initialized from scratch and trained on 4.40M teacher decisions before PPO. It carries its own memory tokens into the next decision. The [release manifest](assets/models/vision-memory/manifest.json) includes the per-seed results, checkpoint and graph checksums, and FP32 export checks. The build and browser verify both model graphs.

## Run locally

Use Node.js 20 or newer.

```sh
npm ci
npm test
npm run build
npm start
```

Open [the local demo](http://127.0.0.1:8787). The build places the static site and pinned browser runtimes in `dist/`. A browser with WebAssembly SIMD support is required.

## Deployment

Pushing to `main` runs the tests and builds the static site. GitHub Actions publishes the build to `gh-pages` and deploys that commit to GitHub Pages. Earlier demo URLs redirect to the same agent.

See the [game source manifest](assets/world-provenance.json) and [third-party notices](THIRD_PARTY_NOTICES.md) for the bundled environment, runtimes and licenses.
