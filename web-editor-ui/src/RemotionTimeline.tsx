import React from 'react';
import { Sequence, useVideoConfig } from 'remotion';
import { Timeline, Track, Clip, timeToFrames } from './otio';
import { PreviewEngine } from './PreviewEngine';

export interface RemotionTimelineProps {
  timeline?: Timeline;
}

export const RemotionTimeline: React.FC<RemotionTimelineProps> = ({ timeline }) => {
  const { fps } = useVideoConfig();

  if (!timeline) return null;

  const videoTrack = timeline.tracks.find(t => t.kind === 'Video');
  if (!videoTrack) return null;

  return (
    <div style={{ flex: 1, backgroundColor: '#111' }}>
      {videoTrack.clips.map((clip: Clip, index: number) => {
        const durationInFrames = timeToFrames(clip.sourceRange.duration, fps);
        const startFrame = videoTrack.clips
            .slice(0, index)
            .reduce((total, c) => total + timeToFrames(c.sourceRange.duration, fps), 0);

        return (
          <Sequence
            key={`${clip.name}-${index}`}
            from={startFrame}
            durationInFrames={durationInFrames}
            name={clip.name}
          >
            <PreviewEngine mediaUrl={clip.mediaReference.targetUrl} />
          </Sequence>
        );
      })}
    </div>
  );
};
