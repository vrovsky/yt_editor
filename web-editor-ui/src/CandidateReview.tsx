import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Timeline, Clip } from './otio';

export interface CandidateClip {
  id: string;
  clip: Clip;
  status: 'pending' | 'approved' | 'rejected' | 'nudged';
  nudgeOffsetMs?: number;
  notes?: string;
}

export interface CandidateReviewProps {
  timeline: Timeline;
  onApprove?: (clipId: string) => void;
  onReject?: (clipId: string) => void;
  onNudge?: (clipId: string, offsetMs: number) => void;
  onRegenerate?: (notes: string, modifiedClips: CandidateClip[]) => void;
  mediaBaseUrl?: string;
}

function extractCandidateClips(timeline: Timeline): CandidateClip[] {
  const MUST_KEEP_TAGS = ['Hook', 'Reveal', 'Emotional Beat', 'Payoff', 'High Energy'];

  const clips: CandidateClip[] = [];

  for (const track of timeline.tracks) {
    if (track.kind !== 'Video') continue;

    for (const clip of track.clips) {
      const isMustKeep = clip.styleTag && MUST_KEEP_TAGS.some(
        tag => clip.styleTag?.toLowerCase().includes(tag.toLowerCase())
      );

      clips.push({
        id: `${track.name}-${clip.name}-${clips.length}`,
        clip,
        status: isMustKeep ? 'pending' : 'approved',
      });
    }
  }

  return clips;
}

function formatTime(ms: number): string {
  const totalSeconds = ms / 1000;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  const milliseconds = Math.floor((ms % 1000) / 10);
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${milliseconds.toString().padStart(2, '0')}`;
}

function getClipTiming(clip: Clip) {
  const startMs = (clip.sourceRange.startTime.value / clip.sourceRange.startTime.rate) * 1000;
  const durationMs = (clip.sourceRange.duration.value / clip.sourceRange.duration.rate) * 1000;
  return { startMs, durationMs };
}

function getClipTimeRange(clip: Clip): string {
  const { startMs, durationMs } = getClipTiming(clip);
  return `${formatTime(startMs)} → ${formatTime(startMs + durationMs)}`;
}

const ClipVideoPlayer: React.FC<{
  clip: CandidateClip;
  mediaBaseUrl: string;
}> = ({ clip, mediaBaseUrl }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const { startMs, durationMs } = getClipTiming(clip.clip);
  const startSec = startMs / 1000;
  const endSec = (startMs + durationMs) / 1000;

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.currentTime = startSec;
      videoRef.current.play().catch(e => console.warn("Auto-play prevented", e));
    }
  }, [clip.id, startSec]);

  const handleTimeUpdate = () => {
    if (videoRef.current && videoRef.current.currentTime >= endSec) {
      videoRef.current.pause();
      videoRef.current.currentTime = startSec;
    }
  };

  const videoSrc = clip.clip.mediaReference.targetUrl.startsWith('http') || clip.clip.mediaReference.targetUrl.startsWith('/') 
    ? clip.clip.mediaReference.targetUrl 
    : `${mediaBaseUrl}${clip.clip.mediaReference.targetUrl}`;

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', backgroundColor: '#000', display: 'flex', justifyContent: 'center' }}>
      <video
        ref={videoRef}
        src={`${videoSrc}#t=${startSec},${endSec}`}
        controls
        autoPlay
        style={{ width: '100%', height: '100%', objectFit: 'contain' }}
        onTimeUpdate={handleTimeUpdate}
      />
    </div>
  );
};

export const CandidateReview: React.FC<CandidateReviewProps> = ({
  timeline,
  onApprove,
  onReject,
  onNudge,
  onRegenerate,
  mediaBaseUrl = '/media/',
}) => {
  const [clips, setClips] = useState<CandidateClip[]>(() => extractCandidateClips(timeline));
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [directorNotes, setDirectorNotes] = useState('');
  const [isRegenerating, setIsRegenerating] = useState(false);

  const selectedClip = clips.find(c => c.id === selectedClipId);

  const handleApprove = useCallback((clipId: string) => {
    setClips(prev => prev.map(c =>
      c.id === clipId ? { ...c, status: 'approved' } : c
    ));
    onApprove?.(clipId);
  }, [onApprove]);

  const handleReject = useCallback((clipId: string) => {
    setClips(prev => prev.map(c =>
      c.id === clipId ? { ...c, status: 'rejected' } : c
    ));
    onReject?.(clipId);
  }, [onReject]);

  const handleNudge = useCallback((clipId: string, direction: 'earlier' | 'later') => {
    const NUDGE_AMOUNT_MS = 500;
    const offset = direction === 'earlier' ? -NUDGE_AMOUNT_MS : NUDGE_AMOUNT_MS;

    setClips(prev => prev.map(c =>
      c.id === clipId
        ? { ...c, status: 'nudged', nudgeOffsetMs: (c.nudgeOffsetMs || 0) + offset }
        : c
    ));
    onNudge?.(clipId, offset);
  }, [onNudge]);

  const handleRegenerate = useCallback(() => {
    if (!directorNotes.trim()) return;

    setIsRegenerating(true);
    onRegenerate?.(directorNotes, clips);

    setTimeout(() => {
      setIsRegenerating(false);
    }, 1500);
  }, [directorNotes, clips, onRegenerate]);

  const pendingCount = clips.filter(c => c.status === 'pending').length;
  const approvedCount = clips.filter(c => c.status === 'approved').length;
  const rejectedCount = clips.filter(c => c.status === 'rejected').length;

  const totalDurationMs = clips.length > 0 
    ? Math.max(...clips.map(c => {
        const { startMs, durationMs } = getClipTiming(c.clip);
        return startMs + durationMs;
      }))
    : 100;

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      maxHeight: '100%',
      backgroundColor: '#0a0a0a',
      color: '#e0e0e0',
      fontFamily: 'monospace',
    }}>
      <div style={{
        padding: '16px 20px',
        borderBottom: '1px solid #333',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>
          🎬 Candidate Review
        </h2>
        <div style={{ display: 'flex', gap: 16, fontSize: 13 }}>
          <span style={{ color: '#FFD500' }}>{pendingCount} pending</span>
          <span style={{ color: '#00FF66' }}>{approvedCount} approved</span>
          <span style={{ color: '#FF3333' }}>{rejectedCount} rejected</span>
        </div>
      </div>

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <div style={{
          width: 320,
          borderRight: '1px solid #333',
          overflowY: 'auto',
        }}>
          {clips.map((candidate) => (
            <div
              key={candidate.id}
              onClick={() => setSelectedClipId(candidate.id)}
              style={{
                padding: '12px 16px',
                borderBottom: '1px solid #222',
                cursor: 'pointer',
                backgroundColor: selectedClipId === candidate.id ? '#1a1a2e' : 'transparent',
                borderLeft: candidate.status === 'approved'
                  ? '3px solid #00FF66'
                  : candidate.status === 'rejected'
                  ? '3px solid #FF3333'
                  : candidate.status === 'nudged'
                  ? '3px solid #60a5fa'
                  : '3px solid #FFD500',
              }}
            >
              <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>
                {candidate.clip.name}
              </div>
              <div style={{ fontSize: 12, color: '#888', marginBottom: 8 }}>
                {getClipTimeRange(candidate.clip)}
              </div>
              {candidate.clip.styleTag && (
                <span style={{
                  display: 'inline-block',
                  padding: '2px 8px',
                  backgroundColor: '#FFD50020',
                  color: '#FFD500',
                  borderRadius: 4,
                  fontSize: 11,
                }}>
                  {candidate.clip.styleTag}
                </span>
              )}
              {candidate.nudgeOffsetMs !== undefined && candidate.nudgeOffsetMs !== 0 && (
                <span style={{
                  marginLeft: 8,
                  color: '#60a5fa',
                  fontSize: 11,
                }}>
                  ↕ {candidate.nudgeOffsetMs > 0 ? '+' : ''}{candidate.nudgeOffsetMs}ms
                </span>
              )}
            </div>
          ))}
        </div>

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          <div style={{
            flex: '0 1 360px',
            minHeight: '200px',
            backgroundColor: '#000',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderBottom: '1px solid #333',
            overflow: 'hidden'
          }}>
            {selectedClip ? (
              <ClipVideoPlayer clip={selectedClip} mediaBaseUrl={mediaBaseUrl} />
            ) : (
              <div style={{ color: '#666' }}>
                Select a clip to review
              </div>
            )}
          </div>

          <div style={{
            height: 24,
            backgroundColor: '#222',
            borderBottom: '1px solid #333',
            position: 'relative',
            width: '100%',
            flexShrink: 0,
          }}>
            {clips.map(c => {
               const { startMs, durationMs } = getClipTiming(c.clip);
               const leftPct = (startMs / totalDurationMs) * 100;
               const widthPct = (durationMs / totalDurationMs) * 100;
               
               let bgColor = '#00FF66';
               if (c.status === 'pending') bgColor = '#FFD500';
               if (c.status === 'rejected') bgColor = '#FF3333';
               if (c.status === 'nudged') bgColor = '#60a5fa';

               return (
                 <div
                    key={`graph-${c.id}`}
                    style={{
                      position: 'absolute',
                      left: `${leftPct}%`,
                      width: `${widthPct}%`,
                      height: '100%',
                      backgroundColor: bgColor,
                      opacity: selectedClipId === c.id || !selectedClipId ? 1 : 0.4,
                      cursor: 'pointer',
                    }}
                    onClick={() => setSelectedClipId(c.id)}
                    title={`${c.clip.name} (${c.status})`}
                 />
               );
            })}
          </div>

          {selectedClip ? (
            <>
              <div style={{ padding: 20, overflowY: 'auto' }}>
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>
                    Clip Details
                  </div>
                  <div style={{ fontSize: 14 }}>
                    <strong>Duration:</strong> {formatTime(
                      (selectedClip.clip.sourceRange.duration.value /
                       selectedClip.clip.sourceRange.duration.rate) * 1000
                    )}
                  </div>
                  {selectedClip.clip.bRoll && (
                    <div style={{ color: '#60a5fa', fontSize: 13, marginTop: 4 }}>
                      ★ B-Roll
                    </div>
                  )}
                </div>

                <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
                  <button
                    onClick={() => handleApprove(selectedClip.id)}
                    disabled={selectedClip.status === 'approved'}
                    style={{
                      flex: 1,
                      padding: '10px 16px',
                      backgroundColor: selectedClip.status === 'approved' ? '#00FF66' : '#00CC52',
                      color: '#fff',
                      border: 'none',
                      borderRadius: 6,
                      cursor: selectedClip.status === 'approved' ? 'default' : 'pointer',
                      fontWeight: 600,
                      fontSize: 13,
                    }}
                  >
                    ✓ Approve
                  </button>
                  <button
                    onClick={() => handleReject(selectedClip.id)}
                    disabled={selectedClip.status === 'rejected'}
                    style={{
                      flex: 1,
                      padding: '10px 16px',
                      backgroundColor: selectedClip.status === 'rejected' ? '#FF3333' : '#E60000',
                      color: '#fff',
                      border: 'none',
                      borderRadius: 6,
                      cursor: selectedClip.status === 'rejected' ? 'default' : 'pointer',
                      fontWeight: 600,
                      fontSize: 13,
                    }}
                  >
                    ✕ Reject
                  </button>
                </div>
            </>
          ) : (
            <div style={{ flex: 1 }} />
          )}

          <div style={{
            padding: 20,
            borderTop: '1px solid #333',
            flex: '0 0 auto',
          }}>
            <div style={{
              fontSize: 12,
              color: '#888',
              marginBottom: 8,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}>
              <span>🎬 User Additional Notes</span>
              <span style={{ fontSize: 11, color: '#666' }}>
                {directorNotes.length}/500
              </span>
            </div>
            <textarea
              value={directorNotes}
              onChange={(e) => setDirectorNotes(e.target.value.slice(0, 500))}
              placeholder="Add notes like: 'More jump cuts in the intro', 'Softer pacing for the reveal', 'Add more B-roll of the product'..."
              style={{
                width: '100%',
                height: 80,
                backgroundColor: '#0f0f0f',
                border: '1px solid #333',
                borderRadius: 6,
                padding: 12,
                color: '#e0e0e0',
                fontSize: 13,
                fontFamily: 'inherit',
                resize: 'none',
              }}
            />
            <button
              onClick={handleRegenerate}
              disabled={!directorNotes.trim() || isRegenerating}
              style={{
                marginTop: 12,
                width: '100%',
                padding: '12px 20px',
                backgroundColor: isRegenerating ? '#6366f1' : '#4f46e5',
                color: '#fff',
                border: 'none',
                borderRadius: 6,
                cursor: directorNotes.trim() && !isRegenerating ? 'pointer' : 'not-allowed',
                fontWeight: 600,
                fontSize: 14,
                opacity: directorNotes.trim() ? 1 : 0.6,
              }}
            >
              {isRegenerating ? '♻️ Regenerating...' : '↻ Regenerate with Notes'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CandidateReview;
