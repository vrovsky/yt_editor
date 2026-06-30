/**
 * ViralCaptions – Animated word-level captions for high retention
 *
 * Uses word-level timestamps from Whisper to create "viral-style" animated captions.
 * Text scales and changes color on the active word, matching the spoken audio.
 */

import React, { useMemo } from 'react';
import { useCurrentFrame, useVideoConfig, AbsoluteFill } from 'remotion';
import { TranscriptSegment, TranscriptWord } from './otio';

export interface ViralCaptionsProps {
  transcript: TranscriptSegment[];
  style?: 'bold' | 'clean' | 'minimal';
  backgroundOpacity?: number;
}

function getActiveWordIndex(
  transcript: TranscriptSegment[],
  currentTimeMs: number,
): { segmentIndex: number; wordIndex: number } | null {
  for (let segIdx = 0; segIdx < transcript.length; segIdx++) {
    const segment = transcript[segIdx];
    if (currentTimeMs >= segment.startMs && currentTimeMs <= segment.endMs) {
      for (let wIdx = 0; wIdx < segment.words.length; wIdx++) {
        const word = segment.words[wIdx];
        if (currentTimeMs >= word.startMs && currentTimeMs <= word.endMs) {
          return { segmentIndex: segIdx, wordIndex: wIdx };
        }
      }
    }
  }
  return null;
}

function formatTime(ms: number): string {
  const totalSeconds = ms / 1000;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

const BoldCaption: React.FC<{
  activeWord: TranscriptWord | null;
  segmentText: string;
  isActive: boolean;
}> = ({ activeWord, segmentText, isActive }) => {
  return (
    <div style={{
      fontFamily: 'Inter, system-ui, sans-serif',
      fontWeight: 800,
      fontSize: 28,
      color: '#fff',
      textAlign: 'center',
      textShadow: '0 2px 8px rgba(0,0,0,0.8)',
      lineHeight: 1.4,
      letterSpacing: '-0.02em',
    }}>
      {segmentText.split(' ').map((word, idx) => {
        const isCurrentWord = activeWord?.text === word;
        return (
          <span
            key={idx}
            style={{
              display: 'inline-block',
              margin: '0 4px',
              transform: isCurrentWord ? 'scale(1.15)' : 'scale(1)',
              color: isCurrentWord ? '#fbbf24' : '#ffffff',
              transition: 'transform 0.1s, color 0.1s',
              opacity: isActive ? 1 : 0.6,
            }}
          >
            {word}
          </span>
        );
      })}
    </div>
  );
};

const CleanCaption: React.FC<{
  activeWord: TranscriptWord | null;
  segmentText: string;
  isActive: boolean;
}> = ({ activeWord, segmentText, isActive }) => {
  return (
    <div style={{
      fontFamily: 'SF Pro Display, -apple-system, sans-serif',
      fontWeight: 500,
      fontSize: 22,
      color: '#fff',
      textAlign: 'center',
      textShadow: '0 1px 4px rgba(0,0,0,0.6)',
      lineHeight: 1.5,
    }}>
      {segmentText.split(' ').map((word, idx) => {
        const isCurrentWord = activeWord?.text === word;
        return (
          <span
            key={idx}
            style={{
              display: 'inline-block',
              margin: '0 3px',
              color: isCurrentWord ? '#fff' : '#a0a0a0',
              fontWeight: isCurrentWord ? 600 : 400,
              opacity: isActive ? 1 : 0,
              transition: 'all 0.2s ease-out',
            }}
          >
            {word}
          </span>
        );
      })}
    </div>
  );
};

const MinimalCaption: React.FC<{
  activeWord: TranscriptWord | null;
  segmentText: string;
  isActive: boolean;
}> = ({ activeWord, segmentText, isActive }) => {
  return (
    <div style={{
      fontFamily: 'monospace',
      fontWeight: 400,
      fontSize: 18,
      color: '#fff',
      textAlign: 'center',
      textShadow: '0 1px 2px rgba(0,0,0,0.5)',
      lineHeight: 1.6,
    }}>
      {segmentText.split(' ').map((word, idx) => {
        const isCurrentWord = activeWord?.text === word;
        return (
          <span
            key={idx}
            style={{
              display: 'inline-block',
              margin: '0 2px',
              borderBottom: isCurrentWord ? '2px solid #fff' : '2px solid transparent',
              opacity: isActive ? (isCurrentWord ? 1 : 0.8) : 0.5,
              transition: 'opacity 0.15s, border-color 0.15s',
            }}
          >
            {word}
          </span>
        );
      })}
    </div>
  );
};

export const ViralCaptions: React.FC<ViralCaptionsProps> = ({
  transcript,
  style = 'bold',
  backgroundOpacity = 0.75,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const currentTimeMs = (frame / fps) * 1000;

  const activeInfo = useMemo(
    () => getActiveWordIndex(transcript, currentTimeMs),
    [transcript, currentTimeMs],
  );

  const activeSegment = activeInfo
    ? transcript[activeInfo.segmentIndex]
    : null;
  const activeWord = activeSegment?.words[activeInfo?.wordIndex ?? 0] ?? null;
  const isActive = currentTimeMs > 500 && activeSegment !== null;
  const segmentText = activeSegment?.text ?? '';

  const captionStyle: React.CSSProperties = {
    position: 'absolute',
    bottom: 120,
    left: '50%',
    transform: 'translateX(-50%)',
    maxWidth: '80%',
    width: '100%',
    padding: '16px 24px',
    backgroundColor: `rgba(0, 0, 0, ${backgroundOpacity})`,
    borderRadius: 12,
    boxShadow: '0 4px 24px rgba(0, 0, 0, 0.4)',
  };

  const renderCaption = () => {
    switch (style) {
      case 'bold':
        return (
          <BoldCaption
            activeWord={activeWord}
            segmentText={segmentText}
            isActive={isActive}
          />
        );
      case 'clean':
        return (
          <CleanCaption
            activeWord={activeWord}
            segmentText={segmentText}
            isActive={isActive}
          />
        );
      case 'minimal':
        return (
          <MinimalCaption
            activeWord={activeWord}
            segmentText={segmentText}
            isActive={isActive}
          />
        );
      default:
        return null;
    }
  };

  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      {activeSegment && (
        <div style={captionStyle}>
          {renderCaption()}
        </div>
      )}

      <div style={{
        position: 'absolute',
        bottom: 40,
        right: 20,
        fontFamily: 'monospace',
        fontSize: 12,
        color: 'rgba(255,255,255,0.4)',
      }}>
        {formatTime(currentTimeMs)}
      </div>
    </AbsoluteFill>
  );
};

export default ViralCaptions;
