import React, { useCallback, useRef, useState } from 'react';

export interface MetadataManifest {
  sourceFile: string;
  durationMs: number;
  fps: number;
  width: number;
  height: number;
  transcript: unknown[];
  sceneChanges: unknown[];
  silentPauses: unknown[];
  saliencyMap: unknown[];
  audioBeats: unknown[];
}

export interface UploadZoneProps {
  onReady: (fileName: string, manifest: MetadataManifest) => void;
  addToast: (msg: string, type?: 'info' | 'success' | 'error') => void;
}

type Phase =
  | { kind: 'idle' }
  | { kind: 'uploading'; progress: number; fileName: string }
  | { kind: 'analyzing'; fileName: string }
  | { kind: 'ready'; fileName: string; manifest: MetadataManifest }
  | { kind: 'error'; message: string };

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

function uploadFile(
  file: File,
  onProgress: (pct: number) => void,
): Promise<{ fileName: string; size: number }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const fd = new FormData();
    fd.append('video', file);

    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    });

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(JSON.parse(xhr.responseText));
      } else {
        try {
          reject(new Error(JSON.parse(xhr.responseText).error ?? xhr.statusText));
        } catch {
          reject(new Error(`Upload failed: ${xhr.status}`));
        }
      }
    });

    xhr.addEventListener('error', () => reject(new Error('Network error during upload')));
    xhr.open('POST', '/api/upload');
    xhr.send(fd);
  });
}

async function analyzeFile(fileName: string): Promise<MetadataManifest> {
  const res = await fetch('/api/analyze-media', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filePath: fileName }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error ?? 'Analysis failed');
  }
  return res.json();
}

const IdleContent: React.FC<{ isDragging: boolean }> = ({ isDragging }) => (
  <div style={{ textAlign: 'center', userSelect: 'none' }}>
    <div style={{
      width: 36, height: 36, margin: '0 auto 12px',
      border: `1px solid ${isDragging ? 'var(--border-focus)' : 'var(--border)'}`,
      borderRadius: 'var(--radius-sm)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: 18, color: isDragging ? 'var(--text-secondary)' : 'var(--text-muted)',
      transition: 'all var(--transition-fast)',
    }}>
      ↑
    </div>
    <p style={{ fontSize: 13, color: isDragging ? 'var(--text-secondary)' : 'var(--text-muted)', marginBottom: 4, transition: 'color var(--transition-fast)' }}>
      {isDragging ? 'Drop to upload' : 'Click to select video'}
    </p>
    <p style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
      mp4 · mov · webm · avi · mkv · up to 4 GB
    </p>
  </div>
);

const GREEN = '#22c55e';

const ProgressBar: React.FC<{
  value: number;
  label: string;
  green?: boolean;
  showCheckAt100?: boolean;
}> = ({ value, label, green, showCheckAt100 }) => {
  const barColor = green ? GREEN : 'var(--text-secondary)';
  const isComplete = showCheckAt100 && value >= 100;
  return (
    <div style={{ width: '100%', maxWidth: 280, textAlign: 'center' }}>
      <div style={{
        height: 2, background: 'var(--border)',
        borderRadius: 1, overflow: 'hidden', marginBottom: 12,
      }}>
        <div style={{
          height: '100%', width: `${value}%`,
          background: barColor,
          transition: 'width 150ms ease',
        }} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'between' }}>
      <p style={{ fontSize: 12, color: isComplete ? barColor : 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
        {label}
      </p>  
      </div>
    </div>
  );
};

const ReadyContent: React.FC<{ fileName: string; manifest: MetadataManifest; onClear: () => void }> = ({
  fileName, manifest, onClear,
}) => (
  <div style={{ textAlign: 'center', width: '100%', maxWidth: 320, userSelect: 'none' }}>
    <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginBottom: 8 }}>
      ✓ ready
    </div>
    <p style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 600, marginBottom: 4 }} className="truncate">
      {fileName.replace(/^\d+_/, '')}
    </p>
    <div style={{ display: 'flex', justifyContent: 'center', gap: 16, marginBottom: 14 }}>
      <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
        {(manifest.durationMs / 1000).toFixed(1)}s
      </span>
      <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
        {manifest.fps} fps
      </span>
      <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
        {manifest.width}×{manifest.height}
      </span>
    </div>
    <button
      className="btn btn-ghost"
      onClick={(e) => { e.stopPropagation(); onClear(); }}
      style={{ fontSize: 11, padding: '0 10px', minHeight: 28 }}
    >
      Change file
    </button>
  </div>
);

export const UploadZone: React.FC<UploadZoneProps> = ({ onReady, addToast }) => {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const processFile = useCallback(async (file: File) => {
    const VALID = ['video/mp4', 'video/quicktime', 'video/webm', 'video/x-msvideo', 'video/x-matroska', 'video/avi'];
    if (file.size === 0) {
      setPhase({ kind: 'error', message: 'File is empty' });
      return;
    }
    if (!VALID.includes(file.type) && !file.name.match(/\.(mp4|mov|webm|avi|mkv)$/i)) {
      setPhase({ kind: 'error', message: `Unsupported format: ${file.type || 'unknown'}` });
      return;
    }

    setPhase({ kind: 'uploading', progress: 0, fileName: file.name });

    try {
      const { fileName } = await uploadFile(file, (pct) =>
        setPhase({ kind: 'uploading', progress: pct, fileName: file.name }),
      );

      setPhase({ kind: 'analyzing', fileName });
      addToast('Upload complete. Analyzing media...', 'info');

      try {
        const manifest = await analyzeFile(fileName);
        setPhase({ kind: 'ready', fileName, manifest });
        onReady(fileName, manifest);
      } catch (analyzeErr) {
        setPhase({ kind: 'error', message: (analyzeErr as Error).message });
        addToast(`Analysis failed: ${(analyzeErr as Error).message}`, 'error');
      }

    } catch (err) {
      setPhase({ kind: 'error', message: (err as Error).message });
      addToast(`Upload failed: ${(err as Error).message}`, 'error');
    }
  }, [onReady, addToast]);

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const onDragLeave = useCallback((e: React.DragEvent) => {
    if (!(e.currentTarget as HTMLDivElement).contains(e.relatedTarget as Node)) {
      setIsDragging(false);
    }
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  }, [processFile]);

  const onFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
    e.target.value = '';
  }, [processFile]);

  const handleClick = useCallback(() => {
    if (phase.kind === 'uploading' || phase.kind === 'analyzing') return;
    inputRef.current?.click();
  }, [phase.kind]);

  const isInteractive = phase.kind === 'idle' || phase.kind === 'error' || phase.kind === 'ready';

  return (
    <div
      onClick={isInteractive ? handleClick : undefined}
      onDragOver={isInteractive ? onDragOver : undefined}
      onDragLeave={isInteractive ? onDragLeave : undefined}
      onDrop={isInteractive ? onDrop : undefined}
      style={{
        width: '100%', maxWidth: 600, alignSelf: 'center',
        aspectRatio: '16 / 9',
        background: isDragging ? 'var(--bg-hover)' : 'var(--bg-elevated)',
        border: `1px ${isDragging ? 'dashed' : 'solid'} ${isDragging ? 'var(--border-focus)' : phase.kind === 'error' ? 'var(--danger)' : 'var(--border)'}`,
        borderRadius: 'var(--radius)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        cursor: isInteractive ? 'pointer' : 'default',
        transition: 'background var(--transition-fast), border-color var(--transition-fast)',
        position: 'relative', overflow: 'hidden',
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept="video/mp4,video/quicktime,video/webm,video/x-msvideo,video/x-matroska,.mp4,.mov,.webm,.avi,.mkv"
        style={{ display: 'none' }}
        onChange={onFileChange}
      />

      {phase.kind === 'idle' && <IdleContent isDragging={isDragging} />}

      {phase.kind === 'uploading' && (
        <ProgressBar
          value={phase.progress}
          label={`Uploading… ${phase.progress}%`}
          green
          showCheckAt100
        />
      )}

      {phase.kind === 'analyzing' && (
        <div style={{ textAlign: 'center' }}>
          <ProgressBar
            value={100}
            label="Analyzing — Whisper / SceneDetect / Saliency…"
          />
          <p style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginTop: 6 }}>
            {phase.fileName.replace(/^\d+_/, '')}
          </p>
        </div>
      )}

      {phase.kind === 'ready' && (
        <ReadyContent
          fileName={phase.fileName}
          manifest={phase.manifest}
          onClear={() => setPhase({ kind: 'idle' })}
        />
      )}

      {phase.kind === 'error' && (
        <div style={{ textAlign: 'center', padding: '0 24px' }}>
          <p style={{ fontSize: 13, color: 'var(--danger)', marginBottom: 8 }}>
            {phase.message}
          </p>
          <button
            className="btn btn-ghost"
            onClick={(e) => { e.stopPropagation(); setPhase({ kind: 'idle' }); }}
            style={{ fontSize: 11, padding: '0 10px', minHeight: 28 }}
          >
            Try again
          </button>
        </div>
      )}
    </div>
  );
};

export default UploadZone;
