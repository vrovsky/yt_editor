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

export function rationalTimeToSeconds(rt: RationalTime): number {
  return rt.value / rt.rate;
}

export function rationalTimeToMs(rt: RationalTime): number {
  return (rt.value / rt.rate) * 1000;
}

export function rationalTimeToFrames(rt: RationalTime, targetFps: number): number {
  return Math.round((rt.value / rt.rate) * targetFps);
}

export function msToRationalTime(ms: number, rate: number): RationalTime {
  return {
    value: Math.round((ms / 1000) * rate),
    rate,
  };
}

export function trackDurationFrames(track: Track): number {
  return track.clips.reduce(
    (total, clip) => total + clip.sourceRange.duration.value,
    0,
  );
}

export function timelineDurationFrames(timeline: Timeline): number {
  const rate = timeline.globalStartTime.rate;
  return Math.max(
    ...timeline.tracks.map((track) =>
      track.clips.reduce(
        (total, clip) =>
          total + rationalTimeToFrames(clip.sourceRange.duration, rate),
        0,
      ),
    ),
  );
}
