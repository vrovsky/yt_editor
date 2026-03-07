let native;
try {
  native = require('./rust-media-engine.win32-x64-msvc.node');
} catch (_err) {
  console.warn(
    '[rust-media-engine] Native binary not found – using JavaScript stubs.\n' +
    '  Run "npm run build:rust" to compile the real engine.\n' +
    '  All analysis results will be mock data.'
  );
  native = null;
}

function stubAnalyzeMedia(buffer, fileName, fps, durationMs, width, height) {
  const segCount = Math.max(1, Math.floor(durationMs / 5000));
  const transcript = Array.from({ length: segCount }, (_, i) => ({
    start: (i * durationMs) / segCount / 1000,
    end: ((i + 1) * durationMs) / segCount / 1000,
    text: `[stub segment ${i + 1}]`,
    words: [],
  }));

  const sceneChanges = Array.from({ length: Math.floor(segCount / 2) }, (_, i) => ({
    frameIndex: Math.floor((i + 1) * fps * (durationMs / 1000) / segCount),
    score: 0.5 + Math.random() * 0.5,
    timestampMs: ((i + 1) * durationMs) / segCount,
  }));

  const silentPauses = Array.from({ length: Math.floor(segCount / 3) }, (_, i) => ({
    startMs: i * 8000,
    endMs: i * 8000 + 600,
    durationMs: 600,
  }));

  const saliencyMap = Array.from({ length: Math.ceil(durationMs / 1000) }, (_, i) => ({
    frameIndex: i * fps,
    timestampMs: i * 1000,
    motionScore: Math.random(),
    facePresence: Math.random() > 0.5,
    focusScore: Math.random(),
    overallSaliency: Math.random(),
  }));

  const audioBeats = Array.from({ length: Math.ceil(durationMs / 500) }, (_, i) => ({
    timestampMs: 500 + i * 500,
    confidence: 0.7 + Math.random() * 0.3,
    bpm: 120,
  }));

  return Promise.resolve({
    sourceFile: fileName,
    durationMs,
    fps,
    width,
    height,
    transcript,
    sceneChanges,
    silentPauses,
    saliencyMap,
    audioBeats,
  });
}

function stubDetectShotChange(buffer, threshold) {
  return Promise.resolve([{ frameIndex: 0, score: 0, timestampMs: 0 }]);
}

function stubSmartExport(timelineJson, sourceFile, outputFile) {
  return Promise.resolve({
    outputFile,
    totalDurationMs: 30000,
    segmentsRemuxed: 5,
    segmentsReencoded: 2,
    speedupFactor: 12.5,
  });
}

module.exports = {
  detect_shot_change: native ? native.detectShotChange : stubDetectShotChange,
  analyze_media:      native ? native.analyzeMedia      : stubAnalyzeMedia,
  extract_metadata:   native ? native.extractMetadata   : stubAnalyzeMedia,
  smart_export:       native ? native.smartExport       : stubSmartExport,
};
