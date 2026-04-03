import { Timeline } from './otioSchema';

export interface ValidationContext {
  sourceFile: string;
  fps: number;
  totalFrames: number;
}

export function validateTimeline(
  timeline: Timeline,
  ctx: ValidationContext,
): string[] {
  const errors: string[] = [];

  if (!timeline.name || typeof timeline.name !== 'string') {
    errors.push('Timeline missing "name" field');
  }

  if (!timeline.globalStartTime) {
    errors.push('Timeline missing "globalStartTime"');
  } else {
    if (typeof timeline.globalStartTime.value !== 'number') {
      errors.push('globalStartTime.value must be a number');
    }
    if (typeof timeline.globalStartTime.rate !== 'number' || timeline.globalStartTime.rate <= 0) {
      errors.push('globalStartTime.rate must be a positive number');
    }
  }

  if (!timeline.tracks || !Array.isArray(timeline.tracks)) {
    errors.push('Timeline missing "tracks" array');
    return errors;
  }

  for (const track of timeline.tracks) {
    if (!track.name) {
      errors.push('Track missing "name"');
    }
    if (!track.kind || (track.kind !== 'Video' && track.kind !== 'Audio')) {
      errors.push(`Track "${track.name}": kind must be "Video" or "Audio"`);
    }
    if (!track.clips || !Array.isArray(track.clips)) {
      errors.push(`Track "${track.name}": missing "clips" array`);
      continue;
    }

    for (let i = 0; i < track.clips.length; i++) {
      const clip = track.clips[i];
      const label = clip.name || `clip[${i}]`;

      if (!clip.sourceRange) {
        errors.push(`${label}: missing sourceRange`);
        continue;
      }
      if (!clip.mediaReference) {
        errors.push(`${label}: missing mediaReference`);
      }

      const sr = clip.sourceRange;

      if (!sr.startTime || typeof sr.startTime.value !== 'number' || typeof sr.startTime.rate !== 'number') {
        errors.push(`${label}: invalid sourceRange.startTime`);
        continue;
      }
      if (!sr.duration || typeof sr.duration.value !== 'number' || typeof sr.duration.rate !== 'number') {
        errors.push(`${label}: invalid sourceRange.duration`);
        continue;
      }

      if (sr.duration.value <= 0) {
        errors.push(`${label}: duration must be positive (got ${sr.duration.value})`);
      }

      if (sr.startTime.value < 0) {
        errors.push(`${label}: startTime.value must be non-negative (got ${sr.startTime.value})`);
      }

      if (sr.startTime.rate !== ctx.fps) {
        errors.push(`${label}: FPS mismatch (clip has ${sr.startTime.rate}, expected ${ctx.fps})`);
      }

      const clipEndFrame = sr.startTime.value + sr.duration.value;
      if (clipEndFrame > ctx.totalFrames) {
        errors.push(
          `${label}: exceeds source (frame ${clipEndFrame} > ${ctx.totalFrames})`
        );
      }

      if (clip.mediaReference && clip.mediaReference.targetUrl !== ctx.sourceFile) {
        errors.push(
          `${label}: unknown source file "${clip.mediaReference.targetUrl}" (expected "${ctx.sourceFile}")`
        );
      }
    }
  }

  return errors;
}
