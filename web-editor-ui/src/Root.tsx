import React from 'react';
import { Composition } from 'remotion';
import { OTIOSequence, OTIOSequenceProps } from './OTIOSequence';
import { RemotionTimeline } from './RemotionTimeline';
import { Timeline, timelineDurationInFrames } from './otio';

const exampleTimeline: Timeline = {
  name: 'MrBeast Style Rough Cut',
  globalStartTime: { value: 0, rate: 30 },
  tracks: [
    {
      name: 'V1 – Primary',
      kind: 'Video',
      clips: [
        {
          name: 'Hook – "So today we are going to…"',
          sourceRange: {
            startTime: { value: 0, rate: 30 },
            duration: { value: 45, rate: 30 },
          },
          mediaReference: {
            targetUrl: 'video_2026-02-25_13-57-38.mp4',
            availableRange: {
              startTime: { value: 0, rate: 30 },
              duration: { value: 1800, rate: 30 },
            },
          },
          styleTag: 'Hook',
        },
        {
          name: 'Context – challenge setup',
          sourceRange: {
            startTime: { value: 90, rate: 30 },
            duration: { value: 60, rate: 30 },
          },
          mediaReference: {
            targetUrl: 'video_2026-02-25_13-57-38.mp4',
            availableRange: {
              startTime: { value: 0, rate: 30 },
              duration: { value: 1800, rate: 30 },
            },
          },
          styleTag: 'High Energy Intro',
        },
        {
          name: 'B-Roll – wide shot',
          sourceRange: {
            startTime: { value: 200, rate: 30 },
            duration: { value: 30, rate: 30 },
          },
          mediaReference: {
            targetUrl: 'video_2026-02-25_13-57-38.mp4',
            availableRange: {
              startTime: { value: 0, rate: 30 },
              duration: { value: 1800, rate: 30 },
            },
          },
          bRoll: true,
          styleTag: 'Visual Reset',
        },
        {
          name: 'Reaction – "you won\'t believe…"',
          sourceRange: {
            startTime: { value: 300, rate: 30 },
            duration: { value: 75, rate: 30 },
          },
          mediaReference: {
            targetUrl: 'video_2026-02-25_13-57-38.mp4',
            availableRange: {
              startTime: { value: 0, rate: 30 },
              duration: { value: 1800, rate: 30 },
            },
          },
          styleTag: 'Emotional Beat',
        },
        {
          name: 'Payoff – reveal',
          sourceRange: {
            startTime: { value: 450, rate: 30 },
            duration: { value: 90, rate: 30 },
          },
          mediaReference: {
            targetUrl: 'video_2026-02-25_13-57-38.mp4',
            availableRange: {
              startTime: { value: 0, rate: 30 },
              duration: { value: 1800, rate: 30 },
            },
          },
          styleTag: 'Payoff',
        },
      ],
    },
  ],
};

const FPS = 30;
const totalDuration = timelineDurationInFrames(exampleTimeline, FPS);

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="OTIOPreview"
        component={OTIOSequence}
        durationInFrames={totalDuration}
        fps={FPS}
        width={1920}
        height={1080}
        defaultProps={{
          timeline: exampleTimeline,
          mediaBaseUrl: '/media/',
          useWebCodecs: false,
        }}
      />

      <Composition
        id="AITimelinePreview"
        component={RemotionTimeline}
        durationInFrames={totalDuration}
        fps={FPS}
        width={1920}
        height={1080}
        defaultProps={{
          timeline: exampleTimeline,
        }}
      />
    </>
  );
};
