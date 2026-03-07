export interface RationalTime {
  value: number;
  rate: number;
}

export interface TimeRange {
  startTime: RationalTime;
  duration: RationalTime;
}

export interface MediaReference {
  targetUrl: string;
  availableRange: TimeRange;
}

export interface Clip {
  name: string;
  sourceRange: TimeRange;
  mediaReference: MediaReference;
  bRoll?: boolean;
  styleTag?: string;
}

export interface Track {
  name: string;
  kind: 'Video' | 'Audio';
  clips: Clip[];
}

export interface Timeline {
  name: string;
  globalStartTime: RationalTime;
  tracks: Track[];
}

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

export function timeToFrames(time: RationalTime, targetFps: number): number {
  return Math.round((time.value / time.rate) * targetFps);
}

export function timeToSeconds(time: RationalTime): number {
  return time.value / time.rate;
}

export function timeToMs(time: RationalTime): number {
  return (time.value / time.rate) * 1000;
}

export function timelineDurationInFrames(
  timeline: Timeline,
  targetFps: number,
): number {
  return Math.max(
    ...timeline.tracks.map((track) =>
      track.clips.reduce(
        (total, clip) => total + timeToFrames(clip.sourceRange.duration, targetFps),
        0,
      ),
    ),
    0,
  );
}
