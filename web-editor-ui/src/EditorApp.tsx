import React, { useState } from 'react';
import { YoutuberDropdown } from './YoutuberDropdown';
import { YouTuberProfile, YOUTUBER_PROFILES } from './styleData';
import { UploadZone, MetadataManifest } from './UploadZone';
import CandidateReview from './CandidateReview';
import { Timeline } from './otio';
import { useEditorStore, type Tab } from './store/editorStore';
import { HeaderUserButton, useCanExport } from './auth/AuthProvider';
import { fetchJsonWithRetry } from './lib/fetchWithRetry';

const TABS = [
  { id: 'preview' as Tab, label: 'Preview', icon: '▶' },
  { id: 'review' as Tab, label: 'Review', icon: '✓' },
  { id: 'export' as Tab, label: 'Export', icon: '↗' },
];

const Meta: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
    <span style={{ fontSize: 9, fontWeight: 600, color: 'var(--text-muted)', letterSpacing: '0.1em', textTransform: 'uppercase', fontFamily: 'var(--font-mono)' }}>
      {label}
    </span>
    <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
      {value}
    </span>
  </div>
);

const PreviewTab: React.FC<{
  youtuber: YouTuberProfile;
  isAnalyzing: boolean;
  onGenerate: () => void;
  onUploaded: (fileName: string, manifest: MetadataManifest) => void;
  manifest: MetadataManifest | null;
  addToast: (msg: string, type?: 'info' | 'success' | 'error') => void;
}> = ({ youtuber, isAnalyzing, onGenerate, onUploaded, manifest, addToast }) => (
  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '20px 16px', gap: 16, overflowY: 'auto' }}>
    <UploadZone onReady={onUploaded} addToast={addToast} />

    <button
      className="btn btn-action"
      onClick={onGenerate}
      disabled={isAnalyzing || manifest === null}
      title={manifest === null ? 'Upload a video first' : undefined}
      style={{ width: '100%', maxWidth: 600, alignSelf: 'center', fontSize: 13, letterSpacing: '0.02em' }}
    >
      {isAnalyzing ? '⏳  Generating…' : manifest ? `⚡  Generate — ${youtuber.name}` : '↑  Upload a video first'}
    </button>

    <div style={{
      width: '100%', maxWidth: 600, alignSelf: 'center',
      background: 'var(--bg-surface)', border: '1px solid var(--border)',
      borderRadius: 'var(--radius)', padding: '14px 16px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, paddingBottom: 12, borderBottom: '1px solid var(--border)' }}>
        <div style={{
          width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 14, background: 'var(--bg-elevated)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius-sm)', flexShrink: 0,
        }}>
          {youtuber.avatar}
        </div>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{youtuber.name}</span>
        <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 'auto', fontFamily: 'var(--font-mono)' }}>
          {youtuber.styleProfile.pacingType}
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 12 }}>
        <Meta label="Cuts/min" value={youtuber.styleProfile.cutDensityPerMinute.toString()} />
        <Meta label="Silence" value={{ remove: 'remove', shorten: 'shorten', keep: 'keep' }[youtuber.styleProfile.silentCutMode]} />
        <Meta label="B-Roll" value={`${Math.round(youtuber.styleProfile.bRollProbability * 100)}%`} />
      </div>

      <p style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.65, marginBottom: 10 }}>
        {youtuber.description}
      </p>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        {youtuber.styleProfile.preferredTransitions.map(t => (
          <span key={t} style={{
            fontSize: 10, padding: '2px 7px',
            background: 'var(--bg-base)', border: '1px solid var(--border)',
            borderRadius: 'var(--radius-sm)', color: 'var(--text-muted)',
            fontFamily: 'var(--font-mono)',
          }}>
            {t}
          </span>
        ))}
      </div>
    </div>
  </div>
);

const ReviewTab: React.FC<{
  timeline: Timeline | null;
  isGenerating: boolean;
}> = ({ timeline, isGenerating }) => {
  if (isGenerating) {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 }}>
        <style>{`
          @keyframes spin { to { transform: rotate(360deg); } }
          @keyframes progress-indeterminate {
            0% { transform: translateX(-100%); }
            100% { transform: translateX(100%); }
          }
        `}</style>
        <div style={{ width: 32, height: 32, border: '3px solid var(--border)', borderTopColor: 'var(--text-secondary)', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
        <div style={{ fontSize: 14, color: 'var(--text-secondary)', fontWeight: 500 }}>Generating AI Edit...</div>
        <div style={{ width: '100%', maxWidth: 280, height: 3, background: 'var(--border)', borderRadius: 2, overflow: 'hidden' }}>
          <div style={{ width: '100%', height: '100%', background: 'var(--text-secondary)', animation: 'progress-indeterminate 1.5s ease-in-out infinite' }} />
        </div>
      </div>
    );
  }

  if (timeline) {
    return <CandidateReview timeline={timeline} />;
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 24 }}>
      <span style={{ fontSize: 28, color: 'var(--text-muted)' }}>✓</span>
      <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>No edit to review</span>
      <span style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center' }}>Generate an edit in the Preview tab first</span>
    </div>
  );
};

const ExportTab: React.FC<{
  timeline: Timeline | null;
  fileName: string | null;
  addToast: (msg: string, type?: 'info' | 'success' | 'error') => void;
  canExport: boolean;
}> = ({ timeline, fileName, addToast, canExport }) => {
  const [exporting, setExporting] = useState(false);
  const [exportResult, setExportResult] = useState<{ url: string; speedupFactor?: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { addToast: storeAddToast, updateToast, removeToast } = useEditorStore();

  const handleExport = async () => {
    if (!timeline || !fileName) return;
    if (!canExport) {
      addToast('Upgrade to Pro or Enterprise to export videos.', 'error');
      return;
    }
    setExporting(true);
    setError(null);
    const toastId = storeAddToast('Export started…', 'info', {
      progress: 5,
      sticky: true,
    });
    try {
      const { jobId } = await fetchJsonWithRetry<{ jobId: string }>(
        '/api/smart-export-job',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            timeline,
            sourceFile: fileName,
            outputFile: `export_${fileName}`,
          }),
        },
        { timeoutMs: 10_000 },
      );

      // eslint-disable-next-line no-constant-condition
      while (true) {
        const job = await fetchJsonWithRetry<{
          id: string;
          type: 'analyze' | 'generate' | 'export';
          status: 'queued' | 'running' | 'success' | 'error';
          label: string;
          progress: number;
          error?: string;
        }>(`/api/jobs/${jobId}`, undefined, { timeoutMs: 15_000 });

        updateToast(toastId, {
          message: job.label,
          progress: job.progress,
        });

        if (job.status === 'success') {
          break;
        }
        if (job.status === 'error') {
          updateToast(toastId, {
            type: 'error',
            message: job.error ?? job.label,
            progress: 100,
          });
          throw new Error(job.error ?? 'Export failed');
        }

        await new Promise((resolve) => setTimeout(resolve, 1500));
      }

      const data = await fetchJsonWithRetry<{ url: string; speedupFactor?: number }>(
        `/api/smart-export-job/${jobId}/result`,
        undefined,
        { timeoutMs: 60_000 },
      );
      setExportResult(data);
      updateToast(toastId, {
        type: 'success',
        message: 'Export complete!',
        progress: 100,
      });
      setTimeout(() => removeToast(toastId), 800);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Export failed';
      setError(msg);
      addToast(msg, 'error');
    } finally {
      setExporting(false);
    }
  };

  const apiBase = import.meta.env.VITE_API_BASE_URL || '';

  if (!timeline || !fileName) {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 24 }}>
        <span style={{ fontSize: 28, color: 'var(--text-muted)' }}>↗</span>
        <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Export unavailable</span>
        <span style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center' }}>Generate an edit in the Preview tab first</span>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 }}>
      <span style={{ fontSize: 28, color: 'var(--text-primary)' }}>↗</span>
      <h2 style={{ fontSize: 16, margin: 0, color: 'var(--text-primary)' }}>Smart Export</h2>

      {exportResult ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
          <div style={{ color: 'var(--text-primary)', fontWeight: 600 }}>Export Complete!</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            Speedup factor: {exportResult.speedupFactor?.toFixed(1)}x
          </div>
          <a href={`${apiBase}${exportResult.url}`} download className="btn btn-action" style={{ textDecoration: 'none', marginTop: 8 }}>
            Download Video
          </a>
        </div>
      ) : (
        <>
          {!canExport && (
            <p style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', maxWidth: 280 }}>
              Upgrade to Pro or Enterprise to export videos.
            </p>
          )}
          <button
            className="btn btn-action"
            onClick={handleExport}
            disabled={exporting || !canExport}
            style={{ minWidth: 200, padding: '10px 20px', fontSize: 13 }}
          >
            {exporting ? '⏳ Exporting...' : 'Export Video'}
          </button>
          {error && <div style={{ color: '#ef4444', fontSize: 12, maxWidth: 300, textAlign: 'center' }}>{error}</div>}

          <div style={{
            marginTop: 8, padding: '12px 14px',
            background: 'var(--bg-surface)', border: '1px solid var(--border)',
            borderRadius: 'var(--radius)', maxWidth: 280, width: '100%',
          }}>
            <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.1em', fontFamily: 'var(--font-mono)', marginBottom: 8 }}>
              SMART EXPORT
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.7, fontFamily: 'var(--font-mono)' }}>
              re-mux  →  GOP-aligned segments<br/>
              re-encode  →  cut boundaries only<br/>
              <span style={{ color: 'var(--text-secondary)' }}>speedup up to ×26</span>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

const TabBar: React.FC<{ active: Tab; onSelect: (t: Tab) => void }> = ({ active, onSelect }) => (
  <div style={{ display: 'flex', padding: '0 16px', borderBottom: '1px solid var(--border)', flexShrink: 0, gap: 0 }}>
    {TABS.map(tab => {
      const isActive = tab.id === active;
      return (
        <button key={tab.id} onClick={() => onSelect(tab.id)} style={{
          padding: '0 14px', height: 40, border: 'none', background: 'transparent', cursor: 'pointer',
          fontSize: 12, fontWeight: isActive ? 600 : 400,
          color: isActive ? 'var(--text-primary)' : 'var(--text-muted)',
          borderBottom: `1px solid ${isActive ? 'var(--text-secondary)' : 'transparent'}`,
          transition: 'color var(--transition-fast)',
          letterSpacing: '0.01em',
        }}>
          {tab.icon} {tab.label}
        </button>
      );
    })}
  </div>
);

const BottomNav: React.FC<{ active: Tab; onSelect: (t: Tab) => void }> = ({ active, onSelect }) => (
  <nav className="mobile-only" style={{
    position: 'fixed', bottom: 0, left: 0, right: 0,
    height: 'calc(var(--bottom-nav-height) + env(safe-area-inset-bottom, 0px))',
    paddingBottom: 'env(safe-area-inset-bottom, 0px)',
    background: 'var(--bg-surface)', borderTop: '1px solid var(--border)',
    display: 'flex', alignItems: 'flex-start', zIndex: 50,
  }}>
    {TABS.map(tab => {
      const isActive = tab.id === active;
      return (
        <button key={tab.id} onClick={() => onSelect(tab.id)} style={{
          flex: 1, height: 'var(--bottom-nav-height)',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          gap: 4, border: 'none', background: 'transparent', cursor: 'pointer',
          color: isActive ? 'var(--text-primary)' : 'var(--text-muted)',
          transition: 'color var(--transition-fast)',
          fontSize: 10, fontWeight: isActive ? 600 : 400,
          letterSpacing: '0.04em',
        }}>
          <span style={{ fontSize: 18 }}>{tab.icon}</span>
          {tab.label.toUpperCase()}
        </button>
      );
    })}
  </nav>
);

export const EditorApp: React.FC = () => {
  const {
    selectedYoutuber,
    activeTab,
    isAnalyzing,
    manifest,
    uploadedFileName,
    timeline,
    toasts,
    setSelectedYoutuber,
    setActiveTab,
    setIsAnalyzing,
    setTimeline,
    addToast,
    updateToast,
    removeToast,
    handleUploaded,
  } = useEditorStore();

  const canExport = useCanExport();
  const youtuber = selectedYoutuber ?? YOUTUBER_PROFILES[0];

  const handleGenerate = async () => {
    const state = useEditorStore.getState();
    const { manifest: m, selectedYoutuber: yt } = state;
    if (!m || !yt) return;
    setActiveTab('review');
    setIsAnalyzing(true);

    const toastId = addToast(
      `Generating edit for ${yt.name}…`,
      'info',
      { progress: 5, sticky: true },
    );

    try {
      const { jobId } = await fetchJsonWithRetry<{ jobId: string }>(
        '/api/generate-edit-deterministic-job',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ manifest: m, style: yt.id }),
        },
        { timeoutMs: 10_000 },
      );

      // poll job
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const job = await fetchJsonWithRetry<{
          id: string;
          type: 'analyze' | 'generate' | 'export';
          status: 'queued' | 'running' | 'success' | 'error';
          label: string;
          progress: number;
          error?: string;
        }>(`/api/jobs/${jobId}`, undefined, { timeoutMs: 15_000 });

        updateToast(toastId, {
          message: job.label,
          progress: job.progress,
        });

        if (job.status === 'success') {
          break;
        }
        if (job.status === 'error') {
          updateToast(toastId, {
            type: 'error',
            message: job.error ?? job.label,
            progress: 100,
          });
          throw new Error(job.error ?? 'Edit generation failed');
        }

        await new Promise((resolve) => setTimeout(resolve, 1500));
      }

      const tl = await fetchJsonWithRetry<Timeline>(
        `/api/generate-edit-deterministic-job/${jobId}/result`,
        undefined,
        { timeoutMs: 60_000 },
      );

      setTimeline(tl);
      updateToast(toastId, {
        type: 'success',
        message: 'Edit generated successfully!',
        progress: 100,
      });
      setTimeout(() => removeToast(toastId), 800);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to generate edit. Retrying may help.';
      addToast(msg, 'error');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const renderContent = () => {
    switch (activeTab) {
      case 'preview':
        return (
          <PreviewTab
            youtuber={youtuber}
            isAnalyzing={isAnalyzing}
            onGenerate={handleGenerate}
            onUploaded={handleUploaded}
            manifest={manifest}
            addToast={addToast}
          />
        );
      case 'review':
        return <ReviewTab timeline={timeline} isGenerating={isAnalyzing} />;
      case 'export':
        return (
          <ExportTab
            timeline={timeline}
            fileName={uploadedFileName}
            addToast={addToast}
            canExport={canExport}
          />
        );
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100dvh', overflow: 'hidden', position: 'relative' }}>
      <style>{`
        @keyframes toast-in {
          from { opacity: 0; transform: translate(-50%, 10px); }
          to { opacity: 1; transform: translate(-50%, 0); }
        }
      `}</style>

      <div style={{
        position: 'fixed',
        bottom: 'calc(var(--bottom-nav-height, 60px) + 24px)',
        left: '50%',
        transform: 'translateX(-50%)',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        zIndex: 100,
        pointerEvents: 'none',
        width: '100%',
        maxWidth: 420,
      }}>
        {toasts.map(t => (
          <div key={t.id} style={{
            background: 'var(--bg-elevated)',
            border: `1px solid ${t.type === 'error' ? 'var(--danger)' : t.type === 'success' ? '#22c55e' : 'var(--border)'}`,
            color: 'var(--text-primary)', padding: '10px 16px', borderRadius: 'var(--radius)',
            fontSize: 13, boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
            display: 'flex', alignItems: 'center', gap: 10, flexDirection: 'column', alignSelf: 'center',
            animation: 'toast-in 0.2s ease-out forwards',
            pointerEvents: 'auto'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, alignSelf: 'stretch' }}>
              {t.type === 'success' && <span style={{ color: '#22c55e', fontSize: 16 }}>✓</span>}
              {t.type === 'error' && <span style={{ color: 'var(--danger)', fontSize: 14 }}>✕</span>}
              {t.type === 'info' && <span style={{ color: 'var(--text-secondary)', fontSize: 14 }}>ℹ</span>}
              <span>{t.message}</span>
            </div>
            {typeof t.progress === 'number' && (
              <div style={{ width: '100%', marginTop: 4 }}>
                <div style={{ height: 3, borderRadius: 2, background: 'var(--border)', overflow: 'hidden' }}>
                  <div
                    style={{
                      height: '100%',
                      width: `${Math.min(Math.max(t.progress, 0), 100)}%`,
                      background:
                        t.type === 'error'
                          ? 'var(--danger)'
                          : t.type === 'success'
                          ? '#22c55e'
                          : 'var(--text-secondary)',
                      transition: 'width 160ms ease-out',
                    }}
                  />
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      <header style={{
        height: 'var(--header-height)',
        display: 'flex', alignItems: 'center', padding: '0 14px', gap: 14,
        background: 'var(--bg-surface)', borderBottom: '1px solid var(--border)',
        flexShrink: 0, zIndex: 10,
      }}>
        <div style={{
          width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center',
          border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
          fontSize: 12, color: 'var(--text-secondary)', flexShrink: 0,
          background: 'var(--bg-elevated)',
        }}>
          ✂
        </div>

        <span className="desktop-only" style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', letterSpacing: '0.06em', fontFamily: 'var(--font-mono)', textTransform: 'uppercase' }}>
          AI Editor
        </span>

        <div className="desktop-only" style={{ width: 1, height: 16, background: 'var(--border)', flexShrink: 0 }} />

        <YoutuberDropdown selected={youtuber} onSelect={setSelectedYoutuber} />

        <div style={{ flex: 1 }} />

        <div className="desktop-only" style={{ display: 'flex', gap: 20, alignItems: 'center', paddingRight: 6 }}>
          <Meta label="Pacing" value={youtuber.styleProfile.pacingType} />
          <Meta label="Cuts/min" value={youtuber.cutDensityLabel} />
        </div>

        <HeaderUserButton />
      </header>

      <div className="desktop-only" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <TabBar active={activeTab} onSelect={setActiveTab} />
        <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
          {renderContent()}
        </div>
      </div>

      <div className="mobile-only" style={{
        flex: 1, display: 'flex', flexDirection: 'column', overflow: 'auto',
        paddingBottom: 'calc(var(--bottom-nav-height) + env(safe-area-inset-bottom, 0px))',
      }}>
        {renderContent()}
      </div>

      <BottomNav active={activeTab} onSelect={setActiveTab} />
    </div>
  );
};

export default EditorApp;
