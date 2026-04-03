import dotenv from 'dotenv';
dotenv.config();

import express, { Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import multer from 'multer';
import { execSync } from 'child_process';

// @ts-ignore
import { detect_shot_change, analyze_media, smart_export } from 'rust-media-engine';

import { MetadataManifest } from './types/metadata';
import {
  StyleProfile,
  STYLE_PROFILES,
  MRBEAST_PROFILE,
  CASEY_NEISTAT_PROFILE,
} from './types/styleProfile';
import { Timeline } from './agent/otioSchema';
import { EditingAgent, OpenAIClient, LLMClient } from './agent/editingAgent';
import {
  createJob,
  getJob,
  updateJob,
  pruneOldJobs,
  Job,
} from './persistence/jobStore';

const app = express();
app.use(express.json({ limit: '500mb' }));

const CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:3000';
app.use((_req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', CORS_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

const PUBLIC_DIR = path.resolve(__dirname, '../../public');
if (!fs.existsSync(PUBLIC_DIR)) {
  fs.mkdirSync(PUBLIC_DIR, { recursive: true });
  console.log('Created upload directory:', PUBLIC_DIR);
}
console.log('Upload directory:', PUBLIC_DIR);

app.use('/media', express.static(PUBLIC_DIR));

function resolvePublicPath(filePath: string): string | null {
  const resolved = path.resolve(PUBLIC_DIR, path.basename(filePath));
  if (!resolved.startsWith(PUBLIC_DIR)) {
    return null;
  }
  return resolved;
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, PUBLIC_DIR),
  filename: (_req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${Date.now()}_${safe}`);
  },
});

const ALLOWED_MIME = new Set([
  'video/mp4', 'video/quicktime', 'video/webm',
  'video/x-msvideo', 'video/x-matroska', 'video/avi',
]);

const upload = multer({
  storage,
  limits: { fileSize: 4 * 1024 ** 3 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${file.mimetype}`));
    }
  },
});

const THRESHOLD = 120.0;

// Prune old jobs every 30 minutes
setInterval(pruneOldJobs, 30 * 60 * 1000);

const apiKey = process.env.OPENAI_API_KEY || '';
const aiModel = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const aiBaseUrl = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';

let editingAgent: EditingAgent;

if (apiKey) {
  const llmClient: LLMClient = new OpenAIClient(apiKey, aiModel, aiBaseUrl);
  editingAgent = new EditingAgent(llmClient);
  console.log(`Editing Agent initialised with ${aiModel} LLM client`);
} else {
  const noopClient: LLMClient = {
    async chat() {
      throw new Error(
        'No OPENAI_API_KEY set – use /api/generate-edit-deterministic instead',
      );
    },
  };
  editingAgent = new EditingAgent(noopClient);
  console.log(
    'Editing Agent initialised in DETERMINISTIC mode (no OPENAI_API_KEY)',
  );
}

// ─── Health Check ────────────────────────────────────────────────────

let ffmpegAvailable = false;
try {
  execSync('ffmpeg -version', { stdio: 'ignore' });
  ffmpegAvailable = true;
} catch {
  console.warn('WARNING: ffmpeg not found in PATH');
}

const startTime = Date.now();

app.get('/api/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    uptime: Math.floor((Date.now() - startTime) / 1000),
    ffmpegAvailable,
    llmConfigured: !!apiKey,
  });
});

// ─── Job Endpoints ───────────────────────────────────────────────────

app.get('/api/jobs/:id', (req: Request, res: Response) => {
  const job = getJob(req.params.id);
  if (!job) {
    return res.status(404).json({ error: 'job not found' });
  }
  res.json(job);
});

app.get('/api/styles', (_req: Request, res: Response) => {
  res.json(STYLE_PROFILES);
});

app.post('/api/upload', (req: Request, res: Response) => {
  upload.single('video')(req, res, (err) => {
    try {
      if (err) {
        const status = err.message.startsWith('Unsupported') ? 415 : 400;
        return res.status(status).json({ error: err.message });
      }
      const file = (req as any).file as Express.Multer.File | undefined;
      if (!file) {
        return res.status(400).json({ error: 'No file received. Use field name "video".' });
      }
      console.log(`Uploaded: ${file.filename} (${(file.size / 1024 / 1024).toFixed(1)} MB)`);
      res.json({
        fileName: file.filename,
        originalName: file.originalname,
        size: file.size,
        path: `/media/${file.filename}`,
      });
    } catch (e) {
      console.error('Upload handler error:', e);
      res.status(500).json({ error: (e as Error).message });
    }
  });
});

app.post('/api/analyze-media', async (req: Request, res: Response) => {
  try {
    const {
      filePath,
      fps = 30,
      durationMs = 60000,
      width = 1920,
      height = 1080,
    } = req.body;

    if (!filePath) {
      return res.status(400).json({ error: 'filePath is required' });
    }

    const absolutePath = resolvePublicPath(filePath);
    if (!absolutePath) {
      return res.status(400).json({ error: 'Invalid file path' });
    }

    if (!fs.existsSync(absolutePath)) {
      return res.status(404).json({ error: `File not found: ${filePath}` });
    }

    const fileBuffer = fs.readFileSync(absolutePath);
    const fileName = path.basename(filePath);

    console.log(
      `Analyzing media: ${fileName} (${(fileBuffer.length / 1024 / 1024).toFixed(1)} MB)...`,
    );

    const manifest: MetadataManifest = await analyze_media(
      fileBuffer,
      fileName,
      fps,
      durationMs,
      width,
      height,
    );

    console.log(
      `Analysis complete: ${manifest.transcript.length} segments, ` +
        `${manifest.sceneChanges.length} scene changes, ` +
        `${manifest.silentPauses.length} silent pauses, ` +
        `${manifest.saliencyMap.length} saliency frames`,
    );

    res.json(manifest);
  } catch (e) {
    console.error('Media analysis error:', e);
    res
      .status(500)
      .json({ error: `Media analysis failed: ${(e as Error).message}` });
  }
});

app.post('/api/analyze-media-job', async (req: Request, res: Response) => {
  const {
    filePath,
    fps = 30,
    durationMs = 60000,
    width = 1920,
    height = 1080,
  } = req.body;

  if (!filePath) {
    return res.status(400).json({ error: 'filePath is required' });
  }

  const absolutePath = resolvePublicPath(filePath);
  if (!absolutePath) {
    return res.status(400).json({ error: 'Invalid file path' });
  }

  if (!fs.existsSync(absolutePath)) {
    return res.status(404).json({ error: `File not found: ${filePath}` });
  }

  const fileBuffer = fs.readFileSync(absolutePath);
  const fileName = path.basename(filePath);

  const job = createJob(
    'analyze',
    `[analyze_media] Starting analysis of '${fileName}'...`,
  );

  res.json({ jobId: job.id });

  const stepLabels: { label: string; progress: number }[] = [
    {
      label: `[analyze_media] Starting analysis of '${fileName}'...`,
      progress: 5,
    },
    {
      label: '[rust-media-engine] Using CPU',
      progress: 10,
    },
    {
      label: '[analyze_media] Step 1/5: Extracting audio ...',
      progress: 25,
    },
    {
      label: '[analyze_media] Step 2/5: Running Whisper transcription ...',
      progress: 45,
    },
    {
      label: '[analyze_media] Step 3/5: Detecting silent pauses ...',
      progress: 60,
    },
    {
      label: '[analyze_media] Step 4/5: Detecting scene changes ...',
      progress: 75,
    },
    {
      label: '[analyze_media] Step 5/5: Analysing saliency ...',
      progress: 90,
    },
  ];

  (async () => {
    let stepIndex = 0;
    updateJob(job.id, {
      status: 'running',
      label: stepLabels[0].label,
      progress: stepLabels[0].progress,
    });

    const timer = setInterval(() => {
      const current = getJob(job.id);
      if (!current || current.status !== 'running') {
        return;
      }
      if (stepIndex < stepLabels.length - 1) {
        stepIndex += 1;
        const step = stepLabels[stepIndex];
        updateJob(job.id, { label: step.label, progress: step.progress });
      }
    }, 5000);

    try {
      console.log(
        `[analyze_media] Starting analysis of '${fileName}' ` +
          `(${(fileBuffer.length / 1024 / 1024).toFixed(1)} MB)`,
      );

      const manifest: MetadataManifest = await analyze_media(
        fileBuffer,
        fileName,
        fps,
        durationMs,
        width,
        height,
      );

      console.log(
        `Analysis complete: ${manifest.transcript.length} segments, ` +
          `${manifest.sceneChanges.length} scene changes, ` +
          `${manifest.silentPauses.length} silent pauses, ` +
          `${manifest.saliencyMap.length} saliency frames`,
      );

      updateJob(job.id, {
        status: 'success',
        label: '[analyze_media] Analysis complete',
        progress: 100,
        result: manifest,
      });
    } catch (e) {
      console.error('Media analysis error (job):', e);
      updateJob(job.id, {
        status: 'error',
        label: '[analyze_media] Analysis failed',
        progress: 100,
        error: (e as Error).message,
      });
    } finally {
      clearInterval(timer);
    }
  })();
});

app.get('/api/analyze-media-job/:id/result', (req: Request, res: Response) => {
  const job = getJob(req.params.id);
  if (!job) {
    return res.status(404).json({ error: 'job not found' });
  }
  if (job.type !== 'analyze') {
    return res.status(400).json({ error: 'wrong job type' });
  }
  if (job.status !== 'success') {
    return res.status(409).json({ error: 'job not finished' });
  }
  res.json(job.result);
});

app.post('/api/extract-metadata', async (req: Request, res: Response) => {
  res.redirect(307, '/api/analyze-media');
});

app.post('/api/generate-edit', async (req: Request, res: Response) => {
  try {
    const { manifest, style } = req.body as {
      manifest: MetadataManifest;
      style: string;
    };

    if (!manifest || !style) {
      return res.status(400).json({ error: 'manifest and style are required' });
    }

    const profile = STYLE_PROFILES[style.toLowerCase()];
    if (!profile) {
      return res.status(400).json({
        error: `Unknown style "${style}". Available: ${Object.keys(STYLE_PROFILES).join(', ')}`,
      });
    }

    if (!apiKey) {
      console.warn('OPENAI_API_KEY not configured. Test endpoints will return deterministic/dummy data.');
      return res.status(503).json({
        error:
          'OPENAI_API_KEY not configured. Use /api/generate-edit-deterministic instead.',
      });
    }

    console.log(`Generating ${profile.name}-style edit via LLM...`);
    const timeline: Timeline = await editingAgent.generateOTIOTimeline(
      manifest,
      profile,
    );

    console.log(
      `OTIO Timeline generated: "${timeline.name}" with ` +
        `${timeline.tracks.reduce((n, t) => n + t.clips.length, 0)} clips`,
    );

    res.json(timeline);
  } catch (e) {
    console.error('Edit generation error:', e);
    res
      .status(500)
      .json({ error: `Edit generation failed: ${(e as Error).message}` });
  }
});

app.post(
  '/api/generate-edit-deterministic',
  (req: Request, res: Response) => {
    try {
      const { manifest, style } = req.body as {
        manifest: MetadataManifest;
        style: string;
      };

      if (!manifest || !style) {
        return res
          .status(400)
          .json({ error: 'manifest and style are required' });
      }

      const profile = STYLE_PROFILES[style.toLowerCase()];
      if (!profile) {
        return res.status(400).json({
          error: `Unknown style "${style}". Available: ${Object.keys(STYLE_PROFILES).join(', ')}`,
        });
      }

      console.log(`Generating ${profile.name}-style edit (deterministic)...`);
      const timeline: Timeline =
        editingAgent.generateOTIOTimelineDeterministic(manifest, profile);

      console.log(
        `OTIO Timeline generated: "${timeline.name}" with ` +
          `${timeline.tracks.reduce((n, t) => n + t.clips.length, 0)} clips`,
      );

      res.json(timeline);
    } catch (e) {
      console.error('Deterministic edit generation error:', e);
      res
        .status(500)
        .json({ error: `Edit generation failed: ${(e as Error).message}` });
    }
  },
);

app.post(
  '/api/generate-edit-deterministic-job',
  (req: Request, res: Response) => {
    const { manifest, style } = req.body as {
      manifest: MetadataManifest;
      style: string;
    };

    if (!manifest || !style) {
      return res
        .status(400)
        .json({ error: 'manifest and style are required' });
    }

    const profile = STYLE_PROFILES[style.toLowerCase()];
    if (!profile) {
      return res.status(400).json({
        error: `Unknown style "${style}". Available: ${Object.keys(
          STYLE_PROFILES,
        ).join(', ')}`,
      });
    }

    const job = createJob(
      'generate',
      `[generate_edit] Starting deterministic ${profile.name}-style edit...`,
    );

    res.json({ jobId: job.id });

    (async () => {
      try {
        updateJob(job.id, {
          status: 'running',
          label: '[generate_edit] Planning cuts...',
          progress: 20,
        });

        const timeline: Timeline =
          editingAgent.generateOTIOTimelineDeterministic(manifest, profile);

        updateJob(job.id, {
          label: '[generate_edit] Building timeline...',
          progress: 70,
        });

        updateJob(job.id, {
          status: 'success',
          label: '[generate_edit] Edit ready',
          progress: 100,
          result: timeline,
        });

        console.log(
          `OTIO Timeline generated (job): "${timeline.name}" with ` +
            `${timeline.tracks.reduce(
              (n, t) => n + t.clips.length,
              0,
            )} clips`,
        );
      } catch (e) {
        console.error('Deterministic edit generation error (job):', e);
        updateJob(job.id, {
          status: 'error',
          label: '[generate_edit] Edit generation failed',
          progress: 100,
          error: (e as Error).message,
        });
      }
    })();
  },
);

app.get(
  '/api/generate-edit-deterministic-job/:id/result',
  (req: Request, res: Response) => {
    const job = getJob(req.params.id);
    if (!job) {
      return res.status(404).json({ error: 'job not found' });
    }
    if (job.type !== 'generate') {
      return res.status(400).json({ error: 'wrong job type' });
    }
    if (job.status !== 'success') {
      return res.status(409).json({ error: 'job not finished' });
    }
    res.json(job.result);
  },
);

app.post('/api/smart-export', async (req: Request, res: Response) => {
  try {
    const { timeline, sourceFile, outputFile } = req.body as {
      timeline: Timeline;
      sourceFile: string;
      outputFile: string;
    };

    if (!timeline || !sourceFile || !outputFile) {
      return res
        .status(400)
        .json({ error: 'timeline, sourceFile, and outputFile are required' });
    }

    const absoluteSourceFile = resolvePublicPath(sourceFile);
    if (!absoluteSourceFile) {
      return res.status(400).json({ error: 'Invalid sourceFile path' });
    }

    const safeOutputName = path.basename(outputFile).replace(/[^a-zA-Z0-9._-]/g, '_');
    const absoluteOutputFile = path.join(PUBLIC_DIR, safeOutputName);

    const videoTrack = timeline.tracks.find((t) => t.kind === 'Video');
    if (!videoTrack) {
      return res.status(400).json({ error: 'No video track in timeline' });
    }

    const fps = timeline.globalStartTime.rate;
    const GOP_SIZE_FRAMES = 30;

    const segments = videoTrack.clips.map((clip, index) => {
      const startMs =
        (clip.sourceRange.startTime.value / clip.sourceRange.startTime.rate) *
        1000;
      const durationMs =
        (clip.sourceRange.duration.value / clip.sourceRange.duration.rate) *
        1000;
      const endMs = startMs + durationMs;

      const isFirstClip = index === 0;
      const startFrame = clip.sourceRange.startTime.value;
      const isAlignedToGOP = startFrame % GOP_SIZE_FRAMES === 0;

      const needsReencode = !isAlignedToGOP && !isFirstClip;

      return {
        sourceFile: absoluteSourceFile,
        startMs,
        endMs,
        needsReencode,
      };
    });

    console.log(
      `Smart Export: ${segments.length} segments ` +
        `(${segments.filter((s) => !s.needsReencode).length} re-mux, ` +
        `${segments.filter((s) => s.needsReencode).length} re-encode)`,
    );
    const result = await smart_export(segments, absoluteOutputFile);

    console.log(
      `Export complete: ${result.outputFile} ` +
        `(${result.speedupFactor.toFixed(1)}x speedup)`,
    );

    res.json({
      ...result,
      url: `/media/${path.basename(result.outputFile)}`,
    });
  } catch (e) {
    console.error('Smart export error:', e);
    res
      .status(500)
      .json({ error: `Smart export failed: ${(e as Error).message}` });
  }
});

app.post('/api/smart-export-job', async (req: Request, res: Response) => {
  const { timeline, sourceFile, outputFile } = req.body as {
    timeline: Timeline;
    sourceFile: string;
    outputFile: string;
  };

  if (!timeline || !sourceFile || !outputFile) {
    return res
      .status(400)
      .json({ error: 'timeline, sourceFile, and outputFile are required' });
  }

  const absoluteSourceFile = resolvePublicPath(sourceFile);
  if (!absoluteSourceFile) {
    return res.status(400).json({ error: 'Invalid sourceFile path' });
  }

  const safeOutputName = path.basename(outputFile).replace(/[^a-zA-Z0-9._-]/g, '_');
  const absoluteOutputFile = path.join(PUBLIC_DIR, safeOutputName);

  const job = createJob('export', '[export] Preparing smart export...');
  res.json({ jobId: job.id });

  (async () => {
    try {
      updateJob(job.id, {
        status: 'running',
        label: '[export] Analyzing segments...',
        progress: 10,
      });

      const videoTrack = timeline.tracks.find((t) => t.kind === 'Video');
      if (!videoTrack) {
        updateJob(job.id, {
          status: 'error',
          label: '[export] No video track in timeline',
          progress: 100,
          error: 'No video track in timeline',
        });
        return;
      }

      const GOP_SIZE_FRAMES = 30;

      const segments = videoTrack.clips.map((clip, index) => {
        const startMs =
          (clip.sourceRange.startTime.value /
            clip.sourceRange.startTime.rate) *
          1000;
        const durationMs =
          (clip.sourceRange.duration.value /
            clip.sourceRange.duration.rate) *
          1000;
        const endMs = startMs + durationMs;

        const isFirstClip = index === 0;
        const startFrame = clip.sourceRange.startTime.value;
        const isAlignedToGOP = startFrame % GOP_SIZE_FRAMES === 0;

        const needsReencode = !isAlignedToGOP && !isFirstClip;

        return {
          sourceFile: absoluteSourceFile,
          startMs,
          endMs,
          needsReencode,
        };
      });

      console.log(
        `Smart Export (job): ${segments.length} segments ` +
          `(${segments.filter((s) => !s.needsReencode).length} re-mux, ` +
          `${segments.filter((s) => s.needsReencode).length} re-encode)`,
      );

      updateJob(job.id, {
        label: '[export] Running media engine...',
        progress: 60,
      });
      const result = await smart_export(segments, absoluteOutputFile);

      console.log(
        `Export complete (job): ${result.outputFile} ` +
          `(${result.speedupFactor.toFixed(1)}x speedup)`,
      );

      updateJob(job.id, {
        status: 'success',
        label: '[export] Export complete',
        progress: 100,
        result: {
          ...result,
          url: `/media/${path.basename(result.outputFile)}`,
        },
      });
    } catch (e) {
      console.error('Smart export error (job):', e);
      updateJob(job.id, {
        status: 'error',
        label: '[export] Export failed',
        progress: 100,
        error: (e as Error).message,
      });
    }
  })();
});

app.get('/api/smart-export-job/:id/result', (req: Request, res: Response) => {
  const job = getJob(req.params.id);
  if (!job) {
    return res.status(404).json({ error: 'job not found' });
  }
  if (job.type !== 'export') {
    return res.status(400).json({ error: 'wrong job type' });
  }
  if (job.status !== 'success') {
    return res.status(409).json({ error: 'job not finished' });
  }
  res.json(job.result);
});

app.post('/api/analyze-video', (req: Request, res: Response) => {
  const dummyVideoBuffer = Buffer.from([10, 250, 40, 200, 150]);

  let shotChanged = false;
  try {
    shotChanged = detect_shot_change(dummyVideoBuffer, THRESHOLD);
    console.log(`Rust Engine Report – Shot changed: ${shotChanged}`);
  } catch (e) {
    console.error('Rust bridging error:', e);
    return res.status(500).json({ error: 'Media Engine failure' });
  }

  const mockOtioResponse: Timeline = {
    name: 'Mock AI Generated Timeline',
    globalStartTime: { value: 0, rate: 30 },
    tracks: [
      {
        name: 'Primary Video',
        kind: 'Video',
        clips: [
          {
            name: shotChanged ? 'Action Cut' : 'Long Take',
            sourceRange: {
              startTime: { value: 0, rate: 30 },
              duration: { value: 150, rate: 30 },
            },
            mediaReference: {
              targetUrl: 'analyzed_clip.mp4',
              availableRange: {
                startTime: { value: 0, rate: 30 },
                duration: { value: 300, rate: 30 },
              },
            },
            styleTag: shotChanged ? 'High Energy Transition' : 'Atmospheric',
          },
        ],
      },
    ],
  };

  res.json(mockOtioResponse);
});

// ─── Regenerate with Notes ───────────────────────────────────────────

app.post('/api/regenerate', (req: Request, res: Response) => {
  try {
    const { manifest, style, notes } = req.body as {
      manifest: MetadataManifest;
      style: string;
      notes?: string;
    };

    if (!manifest || !style) {
      return res.status(400).json({ error: 'manifest and style are required' });
    }

    const baseProfile = STYLE_PROFILES[style.toLowerCase()];
    if (!baseProfile) {
      return res.status(400).json({
        error: `Unknown style "${style}". Available: ${Object.keys(STYLE_PROFILES).join(', ')}`,
      });
    }

    // Apply note-based adjustments to a copy of the profile
    let profile = { ...baseProfile };
    if (notes) {
      const lower = notes.toLowerCase();
      if (lower.includes('faster') || lower.includes('more cuts')) {
        profile = { ...profile, cutDensityPerMinute: profile.cutDensityPerMinute * 1.3 };
      }
      if (lower.includes('slower') || lower.includes('fewer cuts')) {
        profile = { ...profile, cutDensityPerMinute: profile.cutDensityPerMinute * 0.7 };
      }
      if (lower.includes('more b-roll') || lower.includes('more broll')) {
        profile = { ...profile, bRollProbability: Math.min(1.0, profile.bRollProbability + 0.2) };
      }
      if (lower.includes('less b-roll') || lower.includes('less broll')) {
        profile = { ...profile, bRollProbability: Math.max(0.0, profile.bRollProbability - 0.2) };
      }
      if (lower.includes('keep silence') || lower.includes('keep pauses')) {
        profile = { ...profile, silentCutMode: 'keep' as const };
      }
      if (lower.includes('remove silence') || lower.includes('remove pauses')) {
        profile = { ...profile, silentCutMode: 'remove' as const };
      }
    }

    console.log(`Regenerating ${profile.name}-style edit (deterministic)${notes ? ` with notes: "${notes}"` : ''}...`);
    const timeline: Timeline = editingAgent.generateOTIOTimelineDeterministic(manifest, profile);

    console.log(
      `Regenerated timeline: "${timeline.name}" with ${timeline.tracks.reduce((n, t) => n + t.clips.length, 0)} clips`,
    );

    res.json(timeline);
  } catch (e) {
    console.error('Regenerate error:', e);
    res.status(500).json({ error: `Regeneration failed: ${(e as Error).message}` });
  }
});

// ─── Production Static Serving ──────────────────────────────────────

const FRONTEND_DIST = path.resolve(__dirname, '../../web-editor-ui/dist');
if (process.env.NODE_ENV === 'production' && fs.existsSync(FRONTEND_DIST)) {
  app.use(express.static(FRONTEND_DIST));
  // SPA fallback: serve index.html for any non-API, non-media route
  app.get('*', (req: Request, res: Response) => {
    if (!req.path.startsWith('/api/') && !req.path.startsWith('/media/')) {
      res.sendFile(path.join(FRONTEND_DIST, 'index.html'));
    }
  });
  console.log('Serving frontend from', FRONTEND_DIST);
}

// ─── Start Server ───────────────────────────────────────────────────

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Editor Backend listening on port ${PORT}`);
  console.log(`  POST /api/analyze-media              – Media analysis`);
  console.log(`  POST /api/generate-edit-deterministic – Deterministic edit`);
  console.log(`  POST /api/regenerate                 – Regenerate with notes`);
  console.log(`  POST /api/smart-export               – Smart export`);
  console.log(`  GET  /api/health                     – Health check`);
  console.log(`  GET  /api/styles                     – Style profiles`);
});
