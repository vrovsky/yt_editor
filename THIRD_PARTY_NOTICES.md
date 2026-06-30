# Third-Party Notices

This product includes third-party open-source software. The principal
components and their licenses are listed below. This file is a summary; generate
a complete, authoritative manifest before distribution (see "Regenerating").

## ⚠️ ffmpeg — verify before distribution

The runtime Docker image installs **ffmpeg** (Debian package) and the Rust
engine links media libraries for Smart Export. ffmpeg can be built under
**LGPL-2.1+** or, if compiled with GPL components (e.g. `libx264`, `libx265`,
`--enable-gpl`), under **GPL-2.0+/GPL-3.0**. Distributing an image that bundles
a GPL-enabled ffmpeg imposes GPL obligations (source availability for those
components).

**Action items:**
- [ ] Run `ffmpeg -version` in the production image and record the `configuration:`
      flags and library licenses.
- [ ] If GPL components are present, either (a) comply with GPL source-offer
      obligations, or (b) switch to an LGPL build without GPL encoders.

## Node.js / npm dependencies (backend & frontend)

| Package | License |
|---------|---------|
| express | MIT |
| multer | MIT |
| better-sqlite3 | MIT |
| dotenv | BSD-2-Clause |
| @clerk/express, @clerk/clerk-react | MIT |
| react, react-dom | MIT |
| remotion | Remotion License (review for commercial use — may require a company license) |
| zustand | MIT |
| vite, @vitejs/plugin-react | MIT |
| typescript, ts-node, vitest, supertest | MIT / Apache-2.0 |

> **Remotion note:** Remotion is **not** plain MIT — it has its own license that
> may require a paid company license depending on team size and use. Confirm
> compliance before commercial launch.

## Rust crates (rust-media-engine)

| Crate | License |
|-------|---------|
| napi, napi-derive, napi-build | MIT |
| serde, serde_json | MIT OR Apache-2.0 |
| tokio | MIT |
| candle-core, candle-nn, candle-transformers | MIT OR Apache-2.0 |
| hf-hub, tokenizers | Apache-2.0 |
| anyhow | MIT OR Apache-2.0 |
| ort (ONNX Runtime bindings) | MIT OR Apache-2.0 (ONNX Runtime: MIT) |

## Models

| Model | License / Source |
|-------|------------------|
| Whisper (weights via Hugging Face / Candle) | MIT (OpenAI Whisper) |
| Saliency CNN / ONNX model | [CONFIRM the specific model + license you ship] |

## Regenerating a complete manifest

```bash
# npm (both workspaces)
npx license-checker --production --summary

# Rust
cargo install cargo-about && cargo about generate about.hbs > THIRD_PARTY_RUST.html
```

Keep the generated output alongside this file in the distributed artifact.
