import { describe, it, expect } from 'vitest';
import { validateTimeline, ValidationContext } from '../timelineValidator';
import { Timeline } from '../otioSchema';

const ctx: ValidationContext = {
  sourceFile: 'test.mp4',
  fps: 30,
  totalFrames: 1800, // 60 seconds
};

function validTimeline(): Timeline {
  return {
    name: 'Test Timeline',
    globalStartTime: { value: 0, rate: 30 },
    tracks: [
      {
        name: 'V1',
        kind: 'Video',
        clips: [
          {
            name: 'Clip 1',
            sourceRange: {
              startTime: { value: 0, rate: 30 },
              duration: { value: 900, rate: 30 },
            },
            mediaReference: {
              targetUrl: 'test.mp4',
              availableRange: {
                startTime: { value: 0, rate: 30 },
                duration: { value: 1800, rate: 30 },
              },
            },
          },
          {
            name: 'Clip 2',
            sourceRange: {
              startTime: { value: 900, rate: 30 },
              duration: { value: 900, rate: 30 },
            },
            mediaReference: {
              targetUrl: 'test.mp4',
              availableRange: {
                startTime: { value: 0, rate: 30 },
                duration: { value: 1800, rate: 30 },
              },
            },
          },
        ],
      },
    ],
  };
}

describe('validateTimeline', () => {
  it('accepts a valid timeline', () => {
    const errors = validateTimeline(validTimeline(), ctx);
    expect(errors).toHaveLength(0);
  });

  it('rejects missing name', () => {
    const tl = validTimeline();
    (tl as any).name = '';
    const errors = validateTimeline(tl, ctx);
    expect(errors.some(e => e.includes('name'))).toBe(true);
  });

  it('rejects missing globalStartTime', () => {
    const tl = validTimeline();
    (tl as any).globalStartTime = undefined;
    const errors = validateTimeline(tl, ctx);
    expect(errors.some(e => e.includes('globalStartTime'))).toBe(true);
  });

  it('rejects non-positive rate', () => {
    const tl = validTimeline();
    tl.globalStartTime.rate = 0;
    const errors = validateTimeline(tl, ctx);
    expect(errors.some(e => e.includes('positive'))).toBe(true);
  });

  it('rejects missing tracks', () => {
    const tl = validTimeline();
    (tl as any).tracks = undefined;
    const errors = validateTimeline(tl, ctx);
    expect(errors.some(e => e.includes('tracks'))).toBe(true);
  });

  it('rejects zero-duration clip', () => {
    const tl = validTimeline();
    tl.tracks[0].clips[0].sourceRange.duration.value = 0;
    const errors = validateTimeline(tl, ctx);
    expect(errors.some(e => e.includes('positive'))).toBe(true);
  });

  it('rejects negative startTime', () => {
    const tl = validTimeline();
    tl.tracks[0].clips[0].sourceRange.startTime.value = -10;
    const errors = validateTimeline(tl, ctx);
    expect(errors.some(e => e.includes('non-negative'))).toBe(true);
  });

  it('rejects clip exceeding source duration', () => {
    const tl = validTimeline();
    tl.tracks[0].clips[1].sourceRange.duration.value = 2000; // exceeds 1800
    const errors = validateTimeline(tl, ctx);
    expect(errors.some(e => e.includes('exceeds'))).toBe(true);
  });

  it('rejects FPS mismatch', () => {
    const tl = validTimeline();
    tl.tracks[0].clips[0].sourceRange.startTime.rate = 24;
    const errors = validateTimeline(tl, ctx);
    expect(errors.some(e => e.includes('FPS mismatch'))).toBe(true);
  });

  it('rejects unknown source file', () => {
    const tl = validTimeline();
    tl.tracks[0].clips[0].mediaReference.targetUrl = 'wrong.mp4';
    const errors = validateTimeline(tl, ctx);
    expect(errors.some(e => e.includes('unknown source'))).toBe(true);
  });

  it('rejects invalid track kind', () => {
    const tl = validTimeline();
    (tl.tracks[0] as any).kind = 'Subtitle';
    const errors = validateTimeline(tl, ctx);
    expect(errors.some(e => e.includes('Video'))).toBe(true);
  });

  it('reports multiple errors at once', () => {
    const tl = validTimeline();
    tl.tracks[0].clips[0].sourceRange.duration.value = 0;
    tl.tracks[0].clips[0].sourceRange.startTime.value = -5;
    const errors = validateTimeline(tl, ctx);
    expect(errors.length).toBeGreaterThanOrEqual(2);
  });
});
