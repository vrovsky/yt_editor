import { describe, it, expect } from 'vitest';
import {
  rationalTimeToSeconds,
  rationalTimeToMs,
  rationalTimeToFrames,
  msToRationalTime,
  trackDurationFrames,
  timelineDurationFrames,
  Timeline,
  Track,
  Clip,
} from '../otioSchema';

describe('rationalTimeToSeconds', () => {
  it('converts frames to seconds', () => {
    expect(rationalTimeToSeconds({ value: 90, rate: 30 })).toBe(3);
  });

  it('handles non-integer results', () => {
    expect(rationalTimeToSeconds({ value: 1, rate: 30 })).toBeCloseTo(0.0333, 3);
  });

  it('handles value of 0', () => {
    expect(rationalTimeToSeconds({ value: 0, rate: 30 })).toBe(0);
  });
});

describe('rationalTimeToMs', () => {
  it('converts frames to milliseconds', () => {
    expect(rationalTimeToMs({ value: 90, rate: 30 })).toBe(3000);
  });

  it('handles fractional results', () => {
    expect(rationalTimeToMs({ value: 1, rate: 30 })).toBeCloseTo(33.33, 1);
  });
});

describe('rationalTimeToFrames', () => {
  it('converts at same fps', () => {
    expect(rationalTimeToFrames({ value: 90, rate: 30 }, 30)).toBe(90);
  });

  it('converts between different fps', () => {
    // 90 frames at 30fps = 3 seconds = 72 frames at 24fps
    expect(rationalTimeToFrames({ value: 90, rate: 30 }, 24)).toBe(72);
  });
});

describe('msToRationalTime', () => {
  it('converts milliseconds to rational time', () => {
    const rt = msToRationalTime(3000, 30);
    expect(rt.value).toBe(90);
    expect(rt.rate).toBe(30);
  });

  it('rounds to nearest frame', () => {
    const rt = msToRationalTime(33, 30);
    expect(rt.value).toBe(1);
    expect(rt.rate).toBe(30);
  });

  it('handles zero', () => {
    const rt = msToRationalTime(0, 30);
    expect(rt.value).toBe(0);
    expect(rt.rate).toBe(30);
  });
});

function makeClip(startFrame: number, durationFrames: number, fps = 30): Clip {
  return {
    name: 'test',
    sourceRange: {
      startTime: { value: startFrame, rate: fps },
      duration: { value: durationFrames, rate: fps },
    },
    mediaReference: {
      targetUrl: 'test.mp4',
      availableRange: {
        startTime: { value: 0, rate: fps },
        duration: { value: 9000, rate: fps },
      },
    },
  };
}

describe('trackDurationFrames', () => {
  it('sums clip durations', () => {
    const track: Track = {
      name: 'V1',
      kind: 'Video',
      clips: [makeClip(0, 90), makeClip(90, 60), makeClip(150, 30)],
    };
    expect(trackDurationFrames(track)).toBe(180);
  });

  it('returns 0 for empty track', () => {
    const track: Track = { name: 'V1', kind: 'Video', clips: [] };
    expect(trackDurationFrames(track)).toBe(0);
  });
});

describe('timelineDurationFrames', () => {
  it('returns max track duration', () => {
    const timeline: Timeline = {
      name: 'test',
      globalStartTime: { value: 0, rate: 30 },
      tracks: [
        { name: 'V1', kind: 'Video', clips: [makeClip(0, 90), makeClip(90, 60)] },
        { name: 'A1', kind: 'Audio', clips: [makeClip(0, 120)] },
      ],
    };
    expect(timelineDurationFrames(timeline)).toBe(150);
  });
});
