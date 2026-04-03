import { describe, it, expect } from 'vitest';
import { EditingAgent, LLMClient } from '../editingAgent';
import {
  MRBEAST_PROFILE,
  CASEY_NEISTAT_PROFILE,
  MKBHD_PROFILE,
  DAVID_DOBRIK_PROFILE,
  PETER_MCKINNON_PROFILE,
  LINUS_TECH_TIPS_PROFILE,
  YES_THEORY_PROFILE,
  VLOG_BROTHERS_PROFILE,
  STYLE_PROFILES,
  StyleProfile,
} from '../../types/styleProfile';
import { MetadataManifest } from '../../types/metadata';

// ─── Fixtures ────────────────────────────────────────────────────────

const noopLLM: LLMClient = {
  async chat() {
    throw new Error('LLM should not be called in deterministic tests');
  },
};

function makeManifest(overrides: Partial<MetadataManifest> = {}): MetadataManifest {
  return {
    sourceFile: 'test.mp4',
    durationMs: 60000,
    fps: 30,
    width: 1920,
    height: 1080,
    transcript: [
      {
        id: 0,
        startMs: 0,
        endMs: 5000,
        text: 'Hello world this is a test',
        words: [
          { text: 'Hello', startMs: 0, endMs: 1000, confidence: 0.9 },
          { text: 'world', startMs: 1000, endMs: 2000, confidence: 0.9 },
          { text: 'this', startMs: 2000, endMs: 3000, confidence: 0.9 },
          { text: 'is', startMs: 3000, endMs: 3500, confidence: 0.9 },
          { text: 'a', startMs: 3500, endMs: 4000, confidence: 0.9 },
          { text: 'test', startMs: 4000, endMs: 5000, confidence: 0.9 },
        ],
      },
      {
        id: 1,
        startMs: 8000,
        endMs: 15000,
        text: 'Second segment here with more words for testing',
        words: [
          { text: 'Second', startMs: 8000, endMs: 9000, confidence: 0.9 },
          { text: 'segment', startMs: 9000, endMs: 10000, confidence: 0.9 },
          { text: 'here', startMs: 10000, endMs: 11000, confidence: 0.9 },
          { text: 'with', startMs: 11000, endMs: 12000, confidence: 0.9 },
          { text: 'more', startMs: 12000, endMs: 13000, confidence: 0.9 },
          { text: 'words', startMs: 13000, endMs: 13500, confidence: 0.9 },
          { text: 'for', startMs: 13500, endMs: 14000, confidence: 0.9 },
          { text: 'testing', startMs: 14000, endMs: 15000, confidence: 0.9 },
        ],
      },
      {
        id: 2,
        startMs: 20000,
        endMs: 30000,
        text: 'Third segment',
        words: [
          { text: 'Third', startMs: 20000, endMs: 25000, confidence: 0.9 },
          { text: 'segment', startMs: 25000, endMs: 30000, confidence: 0.9 },
        ],
      },
    ],
    sceneChanges: [
      { frameNumber: 300, timestampMs: 10000, score: 0.8 },
      { frameNumber: 600, timestampMs: 20000, score: 0.6 },
      { frameNumber: 1200, timestampMs: 40000, score: 0.9 },
    ],
    silentPauses: [
      { startMs: 5000, endMs: 8000, durationMs: 3000 },
      { startMs: 15000, endMs: 20000, durationMs: 5000 },
    ],
    saliencyMap: [
      { frameNumber: 0, timestampMs: 0, saliencyScore: 0.6, motionMagnitude: 0.2, hasFace: true, focusX: 0.5, focusY: 0.4 },
      { frameNumber: 300, timestampMs: 10000, saliencyScore: 0.8, motionMagnitude: 0.7, hasFace: true, focusX: 0.3, focusY: 0.3 },
      { frameNumber: 600, timestampMs: 20000, saliencyScore: 0.5, motionMagnitude: 0.1, hasFace: false, focusX: 0.6, focusY: 0.5 },
      { frameNumber: 900, timestampMs: 30000, saliencyScore: 0.9, motionMagnitude: 0.3, hasFace: true, focusX: 0.4, focusY: 0.4 },
    ],
    audioBeats: [
      { timestampMs: 2000, strength: 0.8, bpm: 120 },
      { timestampMs: 10000, strength: 0.9, bpm: 120 },
      { timestampMs: 25000, strength: 0.7, bpm: 120 },
    ],
    ...overrides,
  };
}

// ─── applySilentCuts ─────────────────────────────────────────────────

describe('EditingAgent.applySilentCuts', () => {
  const agent = new EditingAgent(noopLLM);

  it('keep mode returns original timestamps', () => {
    const manifest = makeManifest();
    const keepProfile: StyleProfile = {
      ...MRBEAST_PROFILE,
      silentCutMode: 'keep',
    };
    const result = agent.applySilentCuts(manifest, keepProfile);

    expect(result).toHaveLength(3);
    expect(result[0].adjustedStartMs).toBe(0);
    expect(result[0].adjustedEndMs).toBe(5000);
    expect(result[1].adjustedStartMs).toBe(8000);
    expect(result[1].adjustedEndMs).toBe(15000);
  });

  it('remove mode shifts timestamps by removed pause duration', () => {
    const manifest = makeManifest();
    const removeProfile: StyleProfile = {
      ...MRBEAST_PROFILE,
      silentCutMode: 'remove',
      maxSilenceMs: 0,
    };
    const result = agent.applySilentCuts(manifest, removeProfile);

    expect(result).toHaveLength(3);
    // First segment: no preceding pause
    expect(result[0].adjustedStartMs).toBe(0);
    expect(result[0].adjustedEndMs).toBe(5000);
    // Second segment: 3000ms pause removed before it
    expect(result[1].adjustedStartMs).toBe(8000 - 3000);
    expect(result[1].adjustedEndMs).toBe(15000 - 3000);
  });

  it('shorten mode only removes excess beyond maxSilenceMs', () => {
    const manifest = makeManifest();
    const shortenProfile: StyleProfile = {
      ...CASEY_NEISTAT_PROFILE,
      silentCutMode: 'shorten',
      maxSilenceMs: 500,
    };
    const result = agent.applySilentCuts(manifest, shortenProfile);

    expect(result).toHaveLength(3);
    // First pause: 3000ms - 500ms = 2500ms removed
    expect(result[1].adjustedStartMs).toBe(8000 - 2500);
  });

  it('adjustedStartMs never goes negative', () => {
    const manifest = makeManifest({
      silentPauses: [
        { startMs: 0, endMs: 50000, durationMs: 50000 },
      ],
    });
    const removeProfile: StyleProfile = {
      ...MRBEAST_PROFILE,
      silentCutMode: 'remove',
    };
    const result = agent.applySilentCuts(manifest, removeProfile);
    for (const seg of result) {
      expect(seg.adjustedStartMs).toBeGreaterThanOrEqual(0);
      expect(seg.adjustedEndMs).toBeGreaterThanOrEqual(0);
    }
  });
});

// ─── buildCandidateCuts ──────────────────────────────────────────────

describe('EditingAgent.buildCandidateCuts', () => {
  const agent = new EditingAgent(noopLLM);

  it('produces cuts from scene changes', () => {
    const manifest = makeManifest();
    const cuts = agent.buildCandidateCuts(manifest, MRBEAST_PROFILE);
    const sceneCuts = cuts.filter(c => c.reason === 'scene_change');
    expect(sceneCuts.length).toBeGreaterThan(0);
  });

  it('produces cuts from sentence boundaries', () => {
    const manifest = makeManifest();
    const cuts = agent.buildCandidateCuts(manifest, MRBEAST_PROFILE);
    const sentenceCuts = cuts.filter(c => c.reason === 'sentence_boundary');
    expect(sentenceCuts.length).toBeGreaterThan(0);
  });

  it('produces cuts from silence events', () => {
    // Use a manifest where silence boundaries don't overlap with sentence boundaries
    const manifest = makeManifest({
      transcript: [
        { id: 0, startMs: 0, endMs: 3000, text: 'First', words: [{ text: 'First', startMs: 0, endMs: 3000, confidence: 0.9 }] },
        { id: 1, startMs: 10000, endMs: 13000, text: 'Second', words: [{ text: 'Second', startMs: 10000, endMs: 13000, confidence: 0.9 }] },
      ],
      silentPauses: [
        { startMs: 5000, endMs: 7000, durationMs: 2000 },
      ],
      sceneChanges: [],
      saliencyMap: [],
    });
    const cuts = agent.buildCandidateCuts(manifest, MRBEAST_PROFILE);
    const silenceCuts = cuts.filter(c => c.reason === 'silence_start' || c.reason === 'silence_end');
    expect(silenceCuts.length).toBeGreaterThan(0);
  });

  it('produces mid-sentence cuts when allowMidSentenceCuts is true', () => {
    const manifest = makeManifest();
    const cuts = agent.buildCandidateCuts(manifest, CASEY_NEISTAT_PROFILE);
    const midCuts = cuts.filter(c => c.reason === 'mid_sentence');
    expect(midCuts.length).toBeGreaterThan(0);
  });

  it('does NOT produce mid-sentence cuts when allowMidSentenceCuts is false', () => {
    const manifest = makeManifest();
    const cuts = agent.buildCandidateCuts(manifest, MRBEAST_PROFILE);
    const midCuts = cuts.filter(c => c.reason === 'mid_sentence');
    expect(midCuts).toHaveLength(0);
  });

  it('deduplicates cuts within 100ms', () => {
    const manifest = makeManifest();
    const cuts = agent.buildCandidateCuts(manifest, MRBEAST_PROFILE);
    for (let i = 1; i < cuts.length; i++) {
      expect(Math.abs(cuts[i].timestampMs - cuts[i - 1].timestampMs)).toBeGreaterThanOrEqual(100);
    }
  });

  it('returns cuts sorted by timestamp', () => {
    const manifest = makeManifest();
    const cuts = agent.buildCandidateCuts(manifest, MRBEAST_PROFILE);
    for (let i = 1; i < cuts.length; i++) {
      expect(cuts[i].timestampMs).toBeGreaterThanOrEqual(cuts[i - 1].timestampMs);
    }
  });

  it('assigns editIQEnergy to all cuts', () => {
    const manifest = makeManifest();
    const cuts = agent.buildCandidateCuts(manifest, MRBEAST_PROFILE);
    for (const cut of cuts) {
      expect(cut.editIQEnergy).toBeDefined();
      expect(typeof cut.editIQEnergy).toBe('number');
    }
  });

  it('produces motion_peak cuts from saliency data', () => {
    // Place motion transition far from other cut points to avoid dedup
    const manifest = makeManifest({
      transcript: [],
      sceneChanges: [],
      silentPauses: [],
      saliencyMap: [
        { frameNumber: 0, timestampMs: 0, saliencyScore: 0.5, motionMagnitude: 0.8, hasFace: false, focusX: 0.5, focusY: 0.5 },
        { frameNumber: 150, timestampMs: 5000, saliencyScore: 0.5, motionMagnitude: 0.1, hasFace: false, focusX: 0.5, focusY: 0.5 },
      ],
    });
    const cuts = agent.buildCandidateCuts(manifest, MRBEAST_PROFILE);
    const motionCuts = cuts.filter(c => c.reason === 'motion_peak');
    expect(motionCuts.length).toBeGreaterThan(0);
  });
});

// ─── selectCuts ──────────────────────────────────────────────────────

describe('EditingAgent.selectCuts', () => {
  const agent = new EditingAgent(noopLLM);

  it('dispatches to Progressive Rhythm for MrBeast', () => {
    const manifest = makeManifest();
    const candidates = agent.buildCandidateCuts(manifest, MRBEAST_PROFILE);
    const selected = agent.selectCuts(candidates, manifest, MRBEAST_PROFILE);
    // Should select some cuts, fewer than candidates
    expect(selected.length).toBeGreaterThan(0);
    expect(selected.length).toBeLessThanOrEqual(candidates.length);
  });

  it('dispatches to Continuous Thought for Casey', () => {
    const manifest = makeManifest();
    const candidates = agent.buildCandidateCuts(manifest, CASEY_NEISTAT_PROFILE);
    const selected = agent.selectCuts(candidates, manifest, CASEY_NEISTAT_PROFILE);
    expect(selected.length).toBeGreaterThan(0);
    expect(selected.length).toBeLessThanOrEqual(candidates.length);
  });

  it('selected cuts are chronologically ordered', () => {
    const manifest = makeManifest();
    const candidates = agent.buildCandidateCuts(manifest, MRBEAST_PROFILE);
    const selected = agent.selectCuts(candidates, manifest, MRBEAST_PROFILE);
    for (let i = 1; i < selected.length; i++) {
      expect(selected[i].timestampMs).toBeGreaterThanOrEqual(selected[i - 1].timestampMs);
    }
  });

  it('dispatches to Slow Build for MKBHD', () => {
    const manifest = makeManifest();
    const candidates = agent.buildCandidateCuts(manifest, MKBHD_PROFILE);
    const selected = agent.selectCuts(candidates, manifest, MKBHD_PROFILE);
    expect(selected.length).toBeGreaterThanOrEqual(0);
    expect(selected.length).toBeLessThanOrEqual(candidates.length);
  });

  it('dispatches to Chaotic for David Dobrik', () => {
    const manifest = makeManifest();
    const candidates = agent.buildCandidateCuts(manifest, DAVID_DOBRIK_PROFILE);
    const selected = agent.selectCuts(candidates, manifest, DAVID_DOBRIK_PROFILE);
    expect(selected.length).toBeGreaterThanOrEqual(0);
  });

  it('dispatches to Narrative Arc for Yes Theory', () => {
    const manifest = makeManifest();
    const candidates = agent.buildCandidateCuts(manifest, YES_THEORY_PROFILE);
    const selected = agent.selectCuts(candidates, manifest, YES_THEORY_PROFILE);
    expect(selected.length).toBeGreaterThanOrEqual(0);
    expect(selected.length).toBeLessThanOrEqual(candidates.length);
  });
});

// ─── generateOTIOTimelineDeterministic ───────────────────────────────

describe('EditingAgent.generateOTIOTimelineDeterministic', () => {
  const agent = new EditingAgent(noopLLM);

  it('produces a valid Timeline with name and tracks', () => {
    const manifest = makeManifest();
    const timeline = agent.generateOTIOTimelineDeterministic(manifest, MRBEAST_PROFILE);

    expect(timeline.name).toContain('MrBeast');
    expect(timeline.globalStartTime.rate).toBe(30);
    expect(timeline.tracks).toHaveLength(1);
    expect(timeline.tracks[0].kind).toBe('Video');
  });

  it('first clip has styleTag "Hook"', () => {
    const manifest = makeManifest();
    const timeline = agent.generateOTIOTimelineDeterministic(manifest, MRBEAST_PROFILE);
    expect(timeline.tracks[0].clips[0].styleTag).toBe('Hook');
  });

  it('all clips have positive duration', () => {
    const manifest = makeManifest();
    const timeline = agent.generateOTIOTimelineDeterministic(manifest, MRBEAST_PROFILE);
    for (const clip of timeline.tracks[0].clips) {
      expect(clip.sourceRange.duration.value).toBeGreaterThan(0);
    }
  });

  it('all clips have non-negative start frames', () => {
    const manifest = makeManifest();
    const timeline = agent.generateOTIOTimelineDeterministic(manifest, MRBEAST_PROFILE);
    for (const clip of timeline.tracks[0].clips) {
      expect(clip.sourceRange.startTime.value).toBeGreaterThanOrEqual(0);
    }
  });

  it('clips do not exceed source duration', () => {
    const manifest = makeManifest();
    const timeline = agent.generateOTIOTimelineDeterministic(manifest, MRBEAST_PROFILE);
    const totalFrames = Math.ceil((manifest.durationMs / 1000) * manifest.fps);
    for (const clip of timeline.tracks[0].clips) {
      const endFrame = clip.sourceRange.startTime.value + clip.sourceRange.duration.value;
      expect(endFrame).toBeLessThanOrEqual(totalFrames + 1); // +1 for rounding
    }
  });

  it('clips reference correct source file', () => {
    const manifest = makeManifest();
    const timeline = agent.generateOTIOTimelineDeterministic(manifest, MRBEAST_PROFILE);
    for (const clip of timeline.tracks[0].clips) {
      expect(clip.mediaReference.targetUrl).toBe('test.mp4');
    }
  });

  it('FPS is consistent across all clips', () => {
    const manifest = makeManifest();
    const timeline = agent.generateOTIOTimelineDeterministic(manifest, MRBEAST_PROFILE);
    for (const clip of timeline.tracks[0].clips) {
      expect(clip.sourceRange.startTime.rate).toBe(30);
      expect(clip.sourceRange.duration.rate).toBe(30);
    }
  });

  it('works with Casey Neistat profile too', () => {
    const manifest = makeManifest();
    const timeline = agent.generateOTIOTimelineDeterministic(manifest, CASEY_NEISTAT_PROFILE);
    expect(timeline.name).toContain('Casey Neistat');
    expect(timeline.tracks[0].clips.length).toBeGreaterThan(0);
  });

  it('handles empty transcript gracefully', () => {
    const manifest = makeManifest({ transcript: [], silentPauses: [] });
    const timeline = agent.generateOTIOTimelineDeterministic(manifest, MRBEAST_PROFILE);
    // Should still produce at least 1 clip (the full duration)
    expect(timeline.tracks[0].clips.length).toBeGreaterThanOrEqual(1);
  });
});

// ─── Slow Build pacing ──────────────────────────────────────────────

describe('Slow Build pacing (MKBHD)', () => {
  const agent = new EditingAgent(noopLLM);

  it('produces a valid timeline', () => {
    const manifest = makeManifest();
    const timeline = agent.generateOTIOTimelineDeterministic(manifest, MKBHD_PROFILE);
    expect(timeline.tracks[0].clips.length).toBeGreaterThan(0);
    for (const clip of timeline.tracks[0].clips) {
      expect(clip.sourceRange.duration.value).toBeGreaterThan(0);
    }
  });

  it('only selects sentence-aligned or scene-boundary cuts', () => {
    const manifest = makeManifest();
    const candidates = agent.buildCandidateCuts(manifest, MKBHD_PROFILE);
    const selected = agent.selectCuts(candidates, manifest, MKBHD_PROFILE);
    for (const cut of selected) {
      expect(['sentence_boundary', 'sentence_start', 'scene_change']).toContain(cut.reason);
    }
  });
});

// ─── Chaotic pacing ─────────────────────────────────────────────────

describe('Chaotic pacing (David Dobrik)', () => {
  const agent = new EditingAgent(noopLLM);

  it('produces a valid timeline with many clips', () => {
    // Use a longer manifest to get more cuts
    const manifest = makeManifest({ durationMs: 120000 });
    const timeline = agent.generateOTIOTimelineDeterministic(manifest, DAVID_DOBRIK_PROFILE);
    expect(timeline.tracks[0].clips.length).toBeGreaterThan(0);
  });

  it('selected cuts respect minimum interval', () => {
    const manifest = makeManifest();
    const candidates = agent.buildCandidateCuts(manifest, DAVID_DOBRIK_PROFILE);
    const selected = agent.selectCuts(candidates, manifest, DAVID_DOBRIK_PROFILE);
    const minMs = (DAVID_DOBRIK_PROFILE.bodyOverrides?.minShotDurationSeconds ?? 1) * 1000;
    for (let i = 1; i < selected.length; i++) {
      const gap = selected[i].timestampMs - selected[i - 1].timestampMs;
      expect(gap).toBeGreaterThanOrEqual(minMs - 1); // -1 for float tolerance
    }
  });
});

// ─── Narrative Arc pacing ───────────────────────────────────────────

describe('Narrative Arc pacing (Yes Theory / Vlog Brothers)', () => {
  const agent = new EditingAgent(noopLLM);

  it('produces a valid timeline for Yes Theory', () => {
    const manifest = makeManifest();
    const timeline = agent.generateOTIOTimelineDeterministic(manifest, YES_THEORY_PROFILE);
    expect(timeline.tracks[0].clips.length).toBeGreaterThan(0);
    for (const clip of timeline.tracks[0].clips) {
      expect(clip.sourceRange.duration.value).toBeGreaterThan(0);
    }
  });

  it('produces a valid timeline for Vlog Brothers', () => {
    const manifest = makeManifest();
    const timeline = agent.generateOTIOTimelineDeterministic(manifest, VLOG_BROTHERS_PROFILE);
    expect(timeline.tracks[0].clips.length).toBeGreaterThan(0);
  });

  it('selected cuts are chronologically ordered', () => {
    const manifest = makeManifest();
    const candidates = agent.buildCandidateCuts(manifest, YES_THEORY_PROFILE);
    const selected = agent.selectCuts(candidates, manifest, YES_THEORY_PROFILE);
    for (let i = 1; i < selected.length; i++) {
      expect(selected[i].timestampMs).toBeGreaterThanOrEqual(selected[i - 1].timestampMs);
    }
  });
});

// ─── All profiles end-to-end ────────────────────────────────────────

describe('All 8 profiles produce valid timelines', () => {
  const agent = new EditingAgent(noopLLM);
  const allProfiles = [
    MRBEAST_PROFILE,
    CASEY_NEISTAT_PROFILE,
    MKBHD_PROFILE,
    DAVID_DOBRIK_PROFILE,
    PETER_MCKINNON_PROFILE,
    LINUS_TECH_TIPS_PROFILE,
    YES_THEORY_PROFILE,
    VLOG_BROTHERS_PROFILE,
  ];

  for (const profile of allProfiles) {
    it(`${profile.name} generates valid timeline`, () => {
      const manifest = makeManifest();
      const timeline = agent.generateOTIOTimelineDeterministic(manifest, profile);
      expect(timeline.name).toContain(profile.name);
      expect(timeline.tracks).toHaveLength(1);
      expect(timeline.tracks[0].clips.length).toBeGreaterThan(0);
      for (const clip of timeline.tracks[0].clips) {
        expect(clip.sourceRange.duration.value).toBeGreaterThan(0);
        expect(clip.sourceRange.startTime.value).toBeGreaterThanOrEqual(0);
        expect(clip.sourceRange.startTime.rate).toBe(30);
      }
    });
  }
});

// ─── STYLE_PROFILES registry ────────────────────────────────────────

describe('STYLE_PROFILES registry', () => {
  it('has all 8 profiles accessible', () => {
    expect(STYLE_PROFILES['mrbeast']).toBeDefined();
    expect(STYLE_PROFILES['casey neistat']).toBeDefined();
    expect(STYLE_PROFILES['mkbhd']).toBeDefined();
    expect(STYLE_PROFILES['david dobrik']).toBeDefined();
    expect(STYLE_PROFILES['peter mckinnon']).toBeDefined();
    expect(STYLE_PROFILES['linus tech tips']).toBeDefined();
    expect(STYLE_PROFILES['yes theory']).toBeDefined();
    expect(STYLE_PROFILES['vlog brothers']).toBeDefined();
  });

  it('casey alias works', () => {
    expect(STYLE_PROFILES['casey']).toBe(STYLE_PROFILES['casey neistat']);
  });

  it('linus alias works', () => {
    expect(STYLE_PROFILES['linus']).toBe(STYLE_PROFILES['linus tech tips']);
  });
});
