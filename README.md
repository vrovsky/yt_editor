Hack with Audacity Promthero track

# AI Video Editor MVP (Transcript-Driven Rough Rust Based Video Cut Engine)

## Project Description
A full-stack monorepo application implementing a **Transcript-Driven Rough Cut** pipeline. This video editor automates the rough cut phase of editing by:
1. Transcribing raw footage (Whisper).
2. Detecting shot boundaries and visual saliency (av-scenechange & Burn).
3. Utilizing an AI agent to generate an OpenTimelineIO (OTIO) edit sequence based on specific YouTuber style profiles.
4. Providing a hardware-accelerated preview in the browser via WebCodecs.
5. Exporting the final video smartly by only re-encoding at the cut points.

## Architecture

```
┌──────────────────────────┐     ┌───────────────────────────┐     ┌──────────────────────────┐
│  rust-media-engine       │     │   editor-backend          │     │   web-editor-ui           │
│  (NAPI-RS / Rust)        │───▶│   (Express / TS)          │────▶│   (React / Remotion)      │
│                          │     │                           │     │                           │
│  • Whisper (candle)      │     │  • Editing Agent (rig)    │     │  • OTIOSequence.tsx       │
│  • Scene detect (av-sc)  │     │  • Progressive Rhythm     │     │  • WebCodecsRenderer      │
│  • Saliency (Burn)       │     │  • Continuous Thought     │     │  • Hardware-accel decode  │
│  • Smart Export (ffmpeg) │     │  • EditIQ energy min.     │     │  • Series.Sequence        │
└──────────────────────────┘     └───────────────────────────┘     └──────────────────────────┘
```

## Pipeline Flow

```
1. Upload    → POST /api/analyze-media (file buffer, zero-copy to Rust)
2. Analyse   → Rust: Whisper + av-scenechange + Burn saliency
3. Generate  → POST /api/generate-edit (MetadataManifest + StyleProfile → OTIO)
4. Preview   → OTIOSequence renders via WebCodecs VideoDecoder (3-5x faster)
5. Export    → POST /api/smart-export (re-mux unchanged, re-encode at cuts only)
```

---

## Feature Extraction (Rust Core)

### `analyze_media()` – [`rust-media-engine/src/lib.rs`](rust-media-engine/src/lib.rs:283)

Async function exposed via napi-rs that accepts a raw media file buffer and returns a unified `MetadataManifest`.

#### Zero-Copy Buffer Passing

```
┌──────────────────────────────────────────────────────────────────┐
│  JavaScript (V8)                                                 │
│  const buf = fs.readFileSync('video.mp4');                       │
│  const manifest = await analyzeMedia(buf, ...);                  │
│  // buf passed to Rust WITHOUT copying                           │
└──────────────────────┬───────────────────────────────────────────┘
                       │ napi FFI boundary
                       │ Buffer → &[u8] (same physical memory)
┌──────────────────────▼───────────────────────────────────────────┐
│  Rust (napi-rs)                                                  │
│  fn analyze_media(file_buffer: Buffer, ...) {                    │
│      let data: &[u8] = file_buffer.as_ref();                     │
│      // `data` points to the SAME V8 ArrayBuffer memory          │
│      // No allocation, no copy, no GC overhead                   │
│                                                                  │
│      run_whisper_transcription(data, ...);   // candle-whisper   │
│      run_scene_change_detection(data, ...);  // av-scenechange   │
│      run_saliency_detection(data, ...);      // Burn framework   │
│  }                                                               │
└──────────────────────────────────────────────────────────────────┘
```

In simple words, for a 500 MB video file, this saves ~500 MB of heap allocation and avoids a ~200ms memcpy.

#### Components

| Component | Crate | Purpose |
|-----------|-------|---------|
| Whisper Transcription | `candle-transformers` | Word-level timecoded transcript |
| Scene Detection | `av-scenechange` | Shot boundary timestamps with confidence |
| Saliency Detection | `burn` | Per-frame saliency, motion magnitude, face detection |
| Silent Pause Detection | Built-in | Gaps between words ≥ 400ms |

#### Saliency Detector (Burn Framework)

The saliency detector runs a lightweight CNN (MobileNet-v3-small backbone) on downscaled frames to produce:
- **Saliency heatmap** – where the viewer's eye is drawn
- **Motion magnitude** – frame-differencing proxy for optical flow
- **Face/protagonist detection** – binary classifier head
- **Focus point** – normalised (x, y) of the most salient region

---

## Agentic Decision Engine

### Editing Agent – [`editor-backend/src/agent/editingAgent.ts`](editor-backend/src/agent/editingAgent.ts)

Implements the `rig-core` agent pattern:

| rig-core Concept | Implementation |
|------------------|----------------|
| `Agent` | `EditingAgent` class |
| `Tool` | `applySilentCuts()`, `buildCandidateCuts()`, `selectCuts()` |
| `Prompt` | `buildSystemPrompt()`, `buildUserPrompt()` |
| `Extractor` | `parseOTIOResponse()` |

### Outputed Example 
MrBeast: Progressive Rhythm Algorithm

```
Phase 1: HOOK (0 – 30s)
├── Target: 35-38 cuts/min → ~1.6-1.7s per cut
├── Visual reset: every 5-8 seconds
├── Prefer: sentence starts, scene boundaries, face-present frames
└── Silence: remove ALL dead air (jump-cut style)

Phase 2: RAMP (30s – 40s)
├── Linear interpolation from hook → body density
└── Gradual transition, not abrupt

Phase 3: BODY (40s – end)
├── Target: 15-20 cuts/min → 3-4s per cut
├── Shot duration: 20-40 seconds for narrative segments
├── Visual reset: every 15 seconds
└── Prefer: scene-boundary cuts for natural transitions
```

#### Implementation ([`applyProgressiveRhythm()`](editor-backend/src/agent/editingAgent.ts)):

```typescript
for each candidate cut point:
  1. Determine phase (hook / ramp / body)
  2. Compute target cut interval for this phase
  3. Compute EditIQ energy for this cut
  4. Accept cut if:
     - Time since last cut >= target interval × 0.7
     - EditIQ energy is below threshold
     - OR it's a scene boundary (always accepted if >= 50% of target)
```

### Continuous Thought Algorithm

```
1. Mid-sentence cuts: prefer cutting 30-70% through a sentence
   → voiceover bridges two different locations
2. Associative cuts: B-roll illustrates what the speaker mentions
   → 60% probability of associative B-roll insertion
3. Scene-boundary preference: cuts land on detected scene changes
4. Natural cadence: silence shortened to 250ms, not removed
```

### EditIQ Energy Minimisation

Shot selection is formulated as an energy minimisation problem:

```
E(cut) = w_jc × JumpCutPenalty(cut)         // visual discontinuity
       - w_ss × SentenceStartReward(cut)     // lands on sentence start
       - w_mt × MusicalTransientReward(cut)  // lands on audio transient
       - w_sb × SceneBoundaryReward(cut)     // coincides with scene change
       + w_si × SaliencyInterruptPenalty(cut) // interrupts exciting moment
       - w_fp × FacePresenceReward(cut)      // cuts TO face-present frame
```

### OTIO Output Schema

```json
{
  "name": "MrBeast Style Edit – raw_footage.mp4",
  "globalStartTime": { "value": 0, "rate": 30 },
  "tracks": [{
    "name": "V1 – Primary",
    "kind": "Video",
    "clips": [{
      "name": "Hook – \"So today we are going to…\"",
      "sourceRange": {
        "startTime": { "value": 0, "rate": 30 },
        "duration": { "value": 45, "rate": 30 }
      },
      "mediaReference": {
        "targetUrl": "raw_footage.mp4",
        "availableRange": {
          "startTime": { "value": 0, "rate": 30 },
          "duration": { "value": 54000, "rate": 30 }
        }
      },
      "bRoll": false,
      "styleTag": "Hook"
    }]
  }]
}
```

---

## Hardware-Accelerated Rendering

### WebCodecs Custom Renderer – [`web-editor-ui/src/WebCodecsRenderer.tsx`](web-editor-ui/src/WebCodecsRenderer.tsx)

| Feature | FFmpeg.wasm | WebCodecs | Improvement |
|---------|-------------|-----------|-------------|
| Seeking speed | ~200ms | ~40ms | **3-5x faster** |
| File size limit | 2GB (WASM heap) | System RAM | **No limit** |
| Frame accuracy | Keyframe-snapped | Exact frame | **Frame-perfect** |
| GPU utilisation | None (CPU) | Full (VPU/GPU) | **Hardware accel** |
| Frame output | Copy to JS heap | Zero-copy VideoFrame | **Zero-copy** |

#### Seeking Strategy

```
1. KEYFRAME SEEK: Binary search on sample table → O(log n)
   Find nearest keyframe at or before target timestamp

2. DECODE FORWARD: Decode from keyframe to target frame
   For H.264 GOP=30: decode at most 30 frames

3. CACHE: LRU cache of decoded ImageBitmaps
   Avoids re-decode when scrubbing back and forth
```

### Smart Export – [`rust-media-engine/src/lib.rs`](rust-media-engine/src/lib.rs) → [`smart_export()`](rust-media-engine/src/lib.rs:420)

```
Standard export: decode ALL frames → process → encode ALL frames
                 Time: O(total_frames × encode_time)

Smart export:    for each segment:
                   if near cut-point: decode → encode (2-5% of frames)
                   else: copy packet bytes directly (bitstream copy)
                 Time: O(cuts × GOP × encode_time) + O(packets × memcpy)
```

For a 10-minute video with 20 cuts (GOP=30):
- Standard: 18,000 frames × 2ms = **36 seconds**
- Smart: (20 × 30 × 2ms) + (18,000 × 0.01ms) = **1.38 seconds** → **26× faster**

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/styles` | List available style profiles |
| `POST` | `/api/analyze-media` | Extract MetadataManifest (Whisper + scene + saliency) |
| `POST` | `/api/generate-edit` | LLM-powered OTIO generation |
| `POST` | `/api/generate-edit-deterministic` | Deterministic OTIO generation |
| `POST` | `/api/smart-export` | Smart Export (re-mux + selective re-encode) |

---

## TypeScript Interfaces

### MetadataManifest

```typescript
interface MetadataManifest {
  sourceFile: string;
  durationMs: number;
  fps: number;
  width: number;
  height: number;
  transcript: TranscriptSegment[];
  sceneChanges: SceneChange[];
  silentPauses: SilentPause[];
  saliencyMap: SaliencyFrame[];
}

interface SaliencyFrame {
  frameNumber: number;
  timestampMs: number;
  saliencyScore: number;    // 0.0–1.0
  motionMagnitude: number;  // 0.0–1.0
  hasFace: boolean;
  focusX: number;           // 0.0–1.0
  focusY: number;           // 0.0–1.0
}
```

### OTIO Schema

```typescript
interface Timeline {
  name: string;
  globalStartTime: RationalTime;
  tracks: Track[];
}

interface Clip {
  name: string;
  sourceRange: TimeRange;
  mediaReference: MediaReference;
  bRoll?: boolean;
  styleTag?: string;
}

interface RationalTime {
  value: number;  // frame count
  rate: number;   // FPS
}
```

---

## Start-Up Guide

### 1. Prerequisites
- **Node.js** v18+
- **Rust Toolchain** (`rustup`, `cargo`, `rustc`)
- **napi-rs CLI** (`npm install -g @napi-rs/cli`)
- **OpenAI API Key** (optional – deterministic mode works without it)

### 2. Setup
Install the NPM dependencies, then build the Rust core (required for media engine bindings):

```bash
# Install NPM dependencies
npm install

# Build the Rust media engine using napi-rs
npm run build:rust

# (Optional) Export your OpenAI API key for AI generation
export OPENAI_API_KEY=sk-...
```

### 3. Running the App
The application consists of a backend server and a frontend React app. You will need to run both concurrently in separate terminal windows.

**Start the Backend (Port 3001):**
```bash
npm run dev:backend
```

**Start the Web UI (Port 3000):**
```bash
npm run dev:ui
```

## Workspace Structure

- **`rust-media-engine/`** – Rust core: Whisper, scene detection, saliency (Burn), Smart Export (ffmpeg-next)
- **`editor-backend/`** – Express server: Editing Agent (rig-core pattern), style profiles, OTIO generation
- **`web-editor-ui/`** – React/Remotion: OTIOSequence, WebCodecsRenderer, hardware-accelerated preview
