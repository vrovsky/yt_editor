import React, { useState, useEffect, useRef, useCallback } from 'react';
import { YOUTUBER_PROFILES, YouTuberProfile } from './styleData';

function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 640);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 639px)');
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  return isMobile;
}

interface TriggerProps { selected: YouTuberProfile; onClick: () => void; }

const DropdownTrigger: React.FC<TriggerProps> = ({ selected, onClick }) => {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      aria-haspopup="listbox"
      aria-label={`Style: ${selected.name}`}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '6px 12px',
        background: hovered ? 'var(--bg-hover)' : 'var(--bg-elevated)',
        border: `1px solid ${hovered ? 'var(--border-light)' : 'var(--border)'}`,
        borderRadius: 'var(--radius)',
        cursor: 'pointer',
        minHeight: 'var(--min-touch)',
        transition: 'background var(--transition-fast), border-color var(--transition-fast)',
        userSelect: 'none',
      }}
    >
      <span style={{
        width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 14, background: 'var(--bg-base)', border: '1px solid var(--border)',
        borderRadius: 'var(--radius-sm)', flexShrink: 0,
      }}>
        {selected.avatar}
      </span>
      <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', letterSpacing: '-0.01em' }}>
        {selected.name}
      </span>
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ color: 'var(--text-muted)', flexShrink: 0 }}>
        <path d="M2 3.5l3 3 3-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    </button>
  );
};

interface CardProps { profile: YouTuberProfile; isSelected: boolean; onClick: () => void; }

const YouTuberCard: React.FC<CardProps> = ({ profile, isSelected, onClick }) => {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      role="option"
      aria-selected={isSelected}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '10px 14px',
        cursor: 'pointer',
        background: hovered ? 'var(--bg-hover)' : isSelected ? 'var(--bg-elevated)' : 'transparent',
        borderLeft: `2px solid ${isSelected ? 'var(--border-focus)' : 'transparent'}`,
        transition: 'background var(--transition-fast)',
        minHeight: 'var(--min-touch)',
      }}
    >
      {/* Avatar square */}
      <div style={{
        width: 28, height: 28, flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'var(--bg-base)', border: '1px solid var(--border)',
        borderRadius: 'var(--radius-sm)', fontSize: 15,
      }}>
        {profile.avatar}
      </div>

      {/* Info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', display: 'block' }}>
            {profile.name}
          </span>
          {isSelected && (
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ color: 'var(--text-secondary)', flexShrink: 0 }}>
              <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          )}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1, fontFamily: 'var(--font-mono)', letterSpacing: '0.01em' }}>
          {profile.cutDensityLabel}
        </div>
        {/* Tags — single row */}
        <div style={{ display: 'flex', gap: 4, marginTop: 5, flexWrap: 'wrap' }}>
          {profile.tags.map(tag => (
            <span key={tag} style={{
              fontSize: 10, fontWeight: 600, padding: '1px 6px',
              borderRadius: 'var(--radius-sm)',
              background: `${profile.accentColor}18`,
              border: `1px solid ${profile.accentColor}40`,
              color: profile.accentColor,
              letterSpacing: '0.02em',
            }}>
              {tag}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
};

interface ListProps { selected: YouTuberProfile; onSelect: (p: YouTuberProfile) => void; }
const YouTuberList: React.FC<ListProps> = ({ selected, onSelect }) => (
  <div role="listbox" style={{ overflowY: 'auto', flex: 1 }}>
    {YOUTUBER_PROFILES.map(p => (
      <YouTuberCard key={p.id} profile={p} isSelected={p.id === selected.id} onClick={() => onSelect(p)} />
    ))}
  </div>
);

interface DesktopDropdownProps extends ListProps { anchorRef: React.RefObject<HTMLDivElement | null>; onClose: () => void; }
const DesktopDropdown: React.FC<DesktopDropdownProps> = ({ selected, onSelect, anchorRef, onClose }) => {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (panelRef.current?.contains(e.target as Node)) return;
      if (anchorRef.current?.contains(e.target as Node)) return;
      onClose();
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [anchorRef, onClose]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [onClose]);

  return (
    <div ref={panelRef} style={{
      position: 'absolute', top: 'calc(100% + 6px)', left: 0,
      width: 320, maxHeight: 440,
      background: 'var(--bg-surface)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-lg)',
      boxShadow: 'var(--shadow-lg)',
      display: 'flex', flexDirection: 'column',
      overflow: 'hidden', zIndex: 200,
      animation: 'dropIn 180ms ease forwards',
    }}>
      <div style={{ padding: '10px 14px 8px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.1em', textTransform: 'uppercase', fontFamily: 'var(--font-mono)' }}>
          Editing style
        </span>
      </div>
      <YouTuberList selected={selected} onSelect={p => { onSelect(p); onClose(); }} />
    </div>
  );
};

interface BottomSheetProps extends ListProps { onClose: () => void; }
const MobileBottomSheet: React.FC<BottomSheetProps> = ({ selected, onSelect, onClose }) => {
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  return (
    <>
      <div className="overlay-backdrop" onClick={onClose} style={{ zIndex: 200 }} />
      <div
        role="dialog" aria-modal="true"
        style={{
          position: 'fixed', bottom: 0, left: 0, right: 0,
          height: '70vh',
          background: 'var(--bg-surface)',
          borderRadius: 'var(--bottom-sheet-radius) var(--bottom-sheet-radius) 0 0',
          border: '1px solid var(--border)', borderBottom: 'none',
          boxShadow: '0 -4px 24px rgba(0,0,0,0.7)',
          display: 'flex', flexDirection: 'column',
          zIndex: 201,
          animation: 'slideUp var(--transition-slow) forwards',
        }}
      >
        {/* Handle */}
        <div style={{ display: 'flex', justifyContent: 'center', padding: '10px 0 6px' }}>
          <div style={{ width: 32, height: 3, borderRadius: 2, background: 'var(--border-light)' }} />
        </div>

        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '6px 16px 12px', borderBottom: '1px solid var(--border)', flexShrink: 0,
        }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', letterSpacing: '0.03em' }}>
            EDITING STYLE
          </span>
          <button onClick={onClose} aria-label="Close" style={{
            width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'var(--bg-elevated)', border: '1px solid var(--border)',
            borderRadius: 'var(--radius-sm)', cursor: 'pointer', color: 'var(--text-secondary)',
          }}>
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path d="M1 1l8 8M9 1L1 9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        <YouTuberList selected={selected} onSelect={p => { onSelect(p); onClose(); }} />
        <div style={{ height: 'env(safe-area-inset-bottom, 12px)', flexShrink: 0 }} />
      </div>
    </>
  );
};

export interface YoutuberDropdownProps {
  selected: YouTuberProfile;
  onSelect: (profile: YouTuberProfile) => void;
}

export const YoutuberDropdown: React.FC<YoutuberDropdownProps> = ({ selected, onSelect }) => {
  const [open, setOpen] = useState(false);
  const isMobile = useIsMobile();
  const anchorRef = useRef<HTMLDivElement>(null);
  const handleClose = useCallback(() => setOpen(false), []);
  const handleSelect = useCallback((p: YouTuberProfile) => { onSelect(p); setOpen(false); }, [onSelect]);

  return (
    <div ref={anchorRef} style={{ position: 'relative', display: 'inline-flex' }}>
      <DropdownTrigger selected={selected} onClick={() => setOpen(v => !v)} />
      {open && !isMobile && (
        <DesktopDropdown selected={selected} onSelect={handleSelect} anchorRef={anchorRef} onClose={handleClose} />
      )}
      {open && isMobile && (
        <MobileBottomSheet selected={selected} onSelect={handleSelect} onClose={handleClose} />
      )}
    </div>
  );
};

export default YoutuberDropdown;
