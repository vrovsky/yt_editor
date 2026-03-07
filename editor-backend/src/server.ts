import dotenv from 'dotenv';
dotenv.config();

import express, { Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import multer from 'multer';

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

const app = express();
app.use(express.json({ limit: '500mb' }));

app.use((_req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', 'http://localhost:3000');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

app.use('/media', express.static(path.resolve(__dirname, '../../public')));

const PUBLIC_DIR = path.resolve(__dirname, '../../public');
if (!fs.existsSync(PUBLIC_DIR)) fs.mkdirSync(PUBLIC_DIR, { recursive: true });

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

app.get('/api/styles', (_req: Request, res: Response) => {
  res.json(STYLE_PROFILES);
});

app.post('/api/upload', (req: Request, res: Response) => {
  upload.single('video')(req, res, (err) => {
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

    const absolutePath = path.resolve(__dirname, '../../public', filePath);

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
      const isLastClip = index === videoTrack.clips.length - 1;
      const startFrame = clip.sourceRange.startTime.value;
      const isAlignedToGOP = startFrame % GOP_SIZE_FRAMES === 0;

      const needsReencode = !isAlignedToGOP && !isFirstClip;
      const absoluteSourceFile = path.resolve(__dirname, '../../public', sourceFile);

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

    const absoluteOutputFile = path.resolve(__dirname, '../../public', outputFile.replace(/[^a-zA-Z0-9.-]/g, '_'));
    const result = await smart_export(segments, absoluteOutputFile);

    console.log(
      `Export complete: ${result.outputFile} ` +
        `(${result.speedupFactor.toFixed(1)}x speedup)`,
    );

    res.json({
       ...result,
       url: `/media/${path.basename(result.outputFile)}`
    });
  } catch (e) {
    console.error('Smart export error:', e);
    res
      .status(500)
      .json({ error: `Smart export failed: ${(e as Error).message}` });
  }
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

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Editor Backend listening on port ${PORT}`);
  console.log(
    `  POST /api/analyze-media              – Extract MetadataManifest (Whisper + scene + saliency)`,
  );
  console.log(
    `  POST /api/generate-edit              – LLM-powered OTIO generation`,
  );
  console.log(
    `  POST /api/generate-edit-deterministic – Deterministic OTIO generation`,
  );
  console.log(
    `  POST /api/smart-export               – Smart Export (re-mux + selective re-encode)`,
  );
  console.log(
    `  GET  /api/styles                     – List available style profiles`,
  );
});
