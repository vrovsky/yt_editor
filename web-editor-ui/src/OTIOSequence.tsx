import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  OffthreadVideo,
  Series,
  useCurrentFrame,
  useVideoConfig,
  AbsoluteFill,
} from 'remotion';
import { Timeline, Clip, timeToFrames, timeToSeconds } from './otio';
import { WebCodecsRenderer } from './WebCodecsRenderer';

export interface OTIOSequenceProps {
  timeline?: Timeline;
  mediaBaseUrl?: string;
  useWebCodecs?: boolean;
}

interface ClipRendererProps {
  clip: Clip;
  mediaBaseUrl: string;
  useWebCodecs: boolean;
}

const ClipRenderer: React.FC<ClipRendererProps> = ({
  clip,
  mediaBaseUrl,
  useWebCodecs,
}) => {
  const { fps } = useVideoConfig();

  const resolvedUrl = useMemo(() => {
    const url = clip.mediaReference.targetUrl;
    if (
      url.startsWith('http://') ||
      url.startsWith('https://') ||
      url.startsWith('/')
    ) {
      return url;
    }
    return `${mediaBaseUrl}${url}`;
  }, [clip.mediaReference.targetUrl, mediaBaseUrl]);

  const sourceStartSeconds = timeToSeconds(clip.sourceRange.startTime);

  if (useWebCodecs) {
    return (
      <WebCodecsRenderer
        src={resolvedUrl}
        sourceStartSeconds={sourceStartSeconds}
        clipName={clip.name}
        cacheAheadFrames={5}
      />
    );
  }

  const startFromFrame = timeToFrames(clip.sourceRange.startTime, fps);

  return <OffthreadVideo src={resolvedUrl} startFrom={startFromFrame} />;
};

const StyleTagOverlay: React.FC<{ tag?: string; bRoll?: boolean }> = ({
  tag,
  bRoll,
}) => {
  if (!tag && !bRoll) return null;

  return (
    <div
      style={{
        position: 'absolute',
        top: 12,
        left: 12,
        display: 'flex',
        gap: 8,
        zIndex: 10,
      }}
    >
      {tag && (
        <span
          style={{
            background: 'rgba(0, 0, 0, 0.7)',
            color: '#fff',
            padding: '4px 10px',
            borderRadius: 4,
            fontSize: 14,
            fontFamily: 'monospace',
          }}
        >
          {tag}
        </span>
      )}
      {bRoll && (
        <span
          style={{
            background: 'rgba(59, 130, 246, 0.8)',
            color: '#fff',
            padding: '4px 10px',
            borderRadius: 4,
            fontSize: 14,
            fontFamily: 'monospace',
          }}
        >
          B-ROLL
        </span>
      )}
    </div>
  );
};

export const OTIOSequence: React.FC<OTIOSequenceProps> = ({
  timeline,
  mediaBaseUrl = '/media/',
  useWebCodecs: useWebCodecsFlag = false,
}) => {
  const { fps } = useVideoConfig();

  const tracks = timeline?.tracks ?? [];
  const videoTracks = useMemo(
    () => tracks.filter((t) => t.kind === 'Video'),
    [tracks],
  );
  const audioTracks = useMemo(
    () => tracks.filter((t) => t.kind === 'Audio'),
    [tracks],
  );

  if (!timeline || videoTracks.length === 0) {
    return (
      <AbsoluteFill
        style={{
          backgroundColor: '#111',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#666',
          fontSize: 24,
          fontFamily: 'monospace',
        }}
      >
        No video tracks in timeline
      </AbsoluteFill>
    );
  }

  return (
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
      {videoTracks.map((track, trackIndex) => (
        <AbsoluteFill key={`track-${track.name}-${trackIndex}`}>
          <Series>
            {track.clips.map((clip, clipIndex) => {
              const durationInFrames = timeToFrames(
                clip.sourceRange.duration,
                fps,
              );

              if (durationInFrames <= 0) return null;

              return (
                <Series.Sequence
                  key={`${track.name}-clip-${clipIndex}-${clip.name}`}
                  durationInFrames={durationInFrames}
                  name={clip.name}
                >
                  <ClipRenderer
                    clip={clip}
                    mediaBaseUrl={mediaBaseUrl}
                    useWebCodecs={useWebCodecsFlag}
                  />
                  <StyleTagOverlay tag={clip.styleTag} bRoll={clip.bRoll} />
                </Series.Sequence>
              );
            })}
          </Series>
        </AbsoluteFill>
      ))}

      {audioTracks.map((track, trackIndex) => (
        <Series key={`audio-track-${track.name}-${trackIndex}`}>
          {track.clips.map((clip, clipIndex) => {
            const durationInFrames = timeToFrames(
              clip.sourceRange.duration,
              fps,
            );

            if (durationInFrames <= 0) return null;

            const resolvedUrl =
              clip.mediaReference.targetUrl.startsWith('http') ||
              clip.mediaReference.targetUrl.startsWith('/')
                ? clip.mediaReference.targetUrl
                : `${mediaBaseUrl}${clip.mediaReference.targetUrl}`;

            return (
              <Series.Sequence
                key={`${track.name}-audio-${clipIndex}`}
                durationInFrames={durationInFrames}
                name={`${clip.name} (audio)`}
              >
                <OffthreadVideo
                  src={resolvedUrl}
                  startFrom={timeToFrames(clip.sourceRange.startTime, fps)}
                  style={{ display: 'none' }}
                />
              </Series.Sequence>
            );
          })}
        </Series>
      ))}
    </AbsoluteFill>
  );
};

export default OTIOSequence;
