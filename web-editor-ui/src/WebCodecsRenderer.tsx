import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useCurrentFrame, useVideoConfig, AbsoluteFill } from 'remotion';

interface DemuxedSample {
  data: ArrayBuffer;
  timestamp: number;
  duration: number;
  isKeyframe: boolean;
}

interface FrameCacheEntry {
  frameNumber: number;
  bitmap: ImageBitmap;
}

export interface WebCodecsRendererProps {
  src: string;
  sourceStartSeconds: number;
  clipName?: string;
  cacheAheadFrames?: number;
}

export const WebCodecsRenderer: React.FC<WebCodecsRendererProps> = ({
  src,
  sourceStartSeconds,
  clipName = 'clip',
  cacheAheadFrames = 5,
}) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const decoderRef = useRef<VideoDecoder | null>(null);
  const frameCacheRef = useRef<FrameCacheEntry[]>([]);
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sourceTimestampUs = Math.round(
    (sourceStartSeconds + frame / fps) * 1_000_000,
  );

  useEffect(() => {
    if (typeof VideoDecoder === 'undefined') {
      setError('WebCodecs API not available in this browser');
      return;
    }

    let cancelled = false;

    const initDecoder = async () => {
      try {
        const config: VideoDecoderConfig = {
          codec: 'avc1.640028',
          codedWidth: width,
          codedHeight: height,
        };

        const support = await VideoDecoder.isConfigSupported(config);
        if (!support.supported) {
          setError(`Codec not supported: ${config.codec}`);
          return;
        }

        const decoder = new VideoDecoder({
          output: (videoFrame: VideoFrame) => {
            if (cancelled) {
              videoFrame.close();
              return;
            }

            if (canvasRef.current) {
              const ctx = canvasRef.current.getContext('2d');
              if (ctx) {
                ctx.drawImage(
                  videoFrame,
                  0,
                  0,
                  canvasRef.current.width,
                  canvasRef.current.height,
                );
              }
            }

            createImageBitmap(videoFrame).then((bitmap) => {
              if (!cancelled) {
                const cache = frameCacheRef.current;
                cache.push({
                  frameNumber: Math.round(
                    (videoFrame.timestamp / 1_000_000) * fps,
                  ),
                  bitmap,
                });
                while (cache.length > cacheAheadFrames * 2) {
                  const evicted = cache.shift();
                  evicted?.bitmap.close();
                }
              }
            });

            videoFrame.close();
          },
          error: (e: DOMException) => {
            if (!cancelled) {
              console.error(`VideoDecoder error [${clipName}]:`, e);
              setError(`Decoder error: ${e.message}`);
            }
          },
        });

        decoder.configure(config);
        decoderRef.current = decoder;

        if (!cancelled) {
          setIsReady(true);
        }
      } catch (e) {
        if (!cancelled) {
          setError(`Init error: ${(e as Error).message}`);
        }
      }
    };

    initDecoder();

    return () => {
      cancelled = true;
      if (decoderRef.current) {
        decoderRef.current.close();
        decoderRef.current = null;
      }
      for (const entry of frameCacheRef.current) {
        entry.bitmap.close();
      }
      frameCacheRef.current = [];
    };
  }, [src, width, height, clipName, cacheAheadFrames, fps]);

  useEffect(() => {
    if (!isReady || !decoderRef.current) return;

    const targetFrame = Math.round(sourceStartSeconds * fps) + frame;

    const cached = frameCacheRef.current.find(
      (entry) => entry.frameNumber === targetFrame,
    );
    if (cached && canvasRef.current) {
      const ctx = canvasRef.current.getContext('2d');
      if (ctx) {
        ctx.drawImage(
          cached.bitmap,
          0,
          0,
          canvasRef.current.width,
          canvasRef.current.height,
        );
        return;
      }
    }

    // TODO: wire demuxer keyframe seek + decode forward to target frame
  }, [frame, fps, sourceStartSeconds, isReady, sourceTimestampUs]);

  if (error) {
    return (
      <AbsoluteFill
        style={{
          backgroundColor: '#1a0000',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        <span style={{ color: '#ff4444', fontSize: 16, fontFamily: 'monospace' }}>
          WebCodecs Error
        </span>
        <span style={{ color: '#888', fontSize: 12, fontFamily: 'monospace' }}>
          {error}
        </span>
      </AbsoluteFill>
    );
  }

  if (!isReady) {
    return (
      <AbsoluteFill
        style={{
          backgroundColor: '#000',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <span style={{ color: '#666', fontSize: 14, fontFamily: 'monospace' }}>
          Initialising WebCodecs decoder...
        </span>
      </AbsoluteFill>
    );
  }

  return (
    <AbsoluteFill>
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'contain',
          backgroundColor: '#000',
        }}
      />
    </AbsoluteFill>
  );
};

export default WebCodecsRenderer;
