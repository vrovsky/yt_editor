import React, { useEffect, useRef, useState } from 'react';
import { useCurrentFrame, useVideoConfig } from 'remotion';

interface PreviewEngineProps {
  mediaUrl: string;
}

export const PreviewEngine: React.FC<PreviewEngineProps> = ({ mediaUrl }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  const [decoder, setDecoder] = useState<VideoDecoder | null>(null);

  useEffect(() => {
    const newDecoder = new VideoDecoder({
      output: (videoFrame) => {
        if (canvasRef.current) {
          const ctx = canvasRef.current.getContext('2d');
          if (ctx) {
            ctx.drawImage(videoFrame, 0, 0, canvasRef.current.width, canvasRef.current.height);
          }
        }
        videoFrame.close();
      },
      error: (e) => {
        console.error("VideoDecoder error:", e);
      }
    });

    newDecoder.configure({
      codec: 'avc1.640028',
    });

    setDecoder(newDecoder);

    return () => {
      newDecoder.close();
    };
  }, []);

  useEffect(() => {
    if (!decoder) return;
    // TODO: demux and decode chunk for current frame
  }, [frame, decoder]);

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center', backgroundColor: '#000' }}>
      <canvas 
        ref={canvasRef} 
        width={1920} 
        height={1080}
        style={{ maxWidth: '100%', maxHeight: '100%' }}
      />
    </div>
  );
};
