export interface TranscriptWord {
  text: string;
  startMs: number;
  endMs: number;
  confidence: number;
}

export interface TranscriptSegment {
  id: number;
  startMs: number;
  endMs: number;
  text: string;
  words: TranscriptWord[];
}

export interface SceneChange {
  frameNumber: number;
  timestampMs: number;
  score: number;
}

export interface SilentPause {
  startMs: number;
  endMs: number;
  durationMs: number;
}

export interface SaliencyFrame {
  frameNumber: number;
  timestampMs: number;
  saliencyScore: number;
  motionMagnitude: number;
  hasFace: boolean;
  focusX: number;
  focusY: number;
}

export interface AudioBeat {
  timestampMs: number;
  strength: number;
  bpm: number | null;
}

export interface MetadataManifest {
  sourceFile: string;
  durationMs: number;
  fps: number;
  width: number;
  height: number;
  transcript: TranscriptSegment[];
  sceneChanges: SceneChange[];
  silentPauses: SilentPause[];
  saliencyMap: SaliencyFrame[];
  audioBeats: AudioBeat[];
}
