import { create } from 'zustand';
import type { Timeline } from '../otio';
import type { MetadataManifest } from '../UploadZone';
import type { YouTuberProfile } from '../styleData';
import { YOUTUBER_PROFILES } from '../styleData';

export type Tab = 'preview' | 'review' | 'export';

export type Toast = {
  id: string;
  message: string;
  type: 'info' | 'success' | 'error';
  progress?: number;
  sticky?: boolean;
};

interface EditorState {
  selectedYoutuber: YouTuberProfile;
  activeTab: Tab;
  isAnalyzing: boolean;
  manifest: MetadataManifest | null;
  uploadedFileName: string | null;
  timeline: Timeline | null;
  toasts: Toast[];
}

interface EditorActions {
  setSelectedYoutuber: (youtuber: YouTuberProfile) => void;
  setActiveTab: (tab: Tab) => void;
  setIsAnalyzing: (v: boolean) => void;
  setManifest: (m: MetadataManifest | null) => void;
  setUploadedFileName: (name: string | null) => void;
  setTimeline: (t: Timeline | null) => void;
  addToast: (
    message: string,
    type?: 'info' | 'success' | 'error',
    opts?: { progress?: number; sticky?: boolean },
  ) => string;
  updateToast: (id: string, patch: Partial<Omit<Toast, 'id'>>) => void;
  removeToast: (id: string) => void;
  handleUploaded: (fileName: string, manifest: MetadataManifest) => void;
  reset: () => void;
}

const initialToast: Toast[] = [];

const getInitialState = (): EditorState => ({
  selectedYoutuber: YOUTUBER_PROFILES[0],
  activeTab: 'preview',
  isAnalyzing: false,
  manifest: null,
  uploadedFileName: null,
  timeline: null,
  toasts: initialToast,
});

export const useEditorStore = create<EditorState & EditorActions>((set, get) => ({
  ...getInitialState(),

  setSelectedYoutuber: (youtuber) => set({ selectedYoutuber: youtuber }),
  setActiveTab: (tab) => set({ activeTab: tab }),
  setIsAnalyzing: (v) => set({ isAnalyzing: v }),
  setManifest: (m) => set({ manifest: m }),
  setUploadedFileName: (name) => set({ uploadedFileName: name }),
  setTimeline: (t) => set({ timeline: t }),

  addToast: (message, type = 'info', opts) => {
    const id = Math.random().toString(36).substring(2, 9);
    set((s) => ({ toasts: [...s.toasts, { id, message, type, ...opts }] }));
    if (!opts?.sticky) {
      setTimeout(() => get().removeToast(id), 3000);
    }
    return id;
  },

  updateToast: (id, patch) =>
    set((s) => ({
      toasts: s.toasts.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    })),

  removeToast: (id) =>
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  handleUploaded: (fileName, manifest) => {
    set({ uploadedFileName: fileName, manifest });
    get().addToast(`Analyzed ${fileName} successfully!`, 'success');
  },

  reset: () => set(getInitialState()),
}));
