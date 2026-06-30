import { describe, it, expect } from 'vitest';
import { EditingAgent, LLMClient } from '../editingAgent';
import {
  HIGH_ENERGY_HOOK_PROFILE,
  CONTINUOUS_VLOG_PROFILE,
  CLEAN_TECH_REVIEW_PROFILE,
  RAPID_REACTION_PROFILE,
  CINEMATIC_VLOG_PROFILE,
  FAST_INFORMATIVE_PROFILE,
  NARRATIVE_ADVENTURE_PROFILE,
  LONG_FORM_ESSAY_PROFILE,
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
      ...HIGH_ENERGY_HOOK_PROFILE,
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
      ...HIGH_ENERGY_HOOK_PROFILE,
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
      ...CONTINUOUS_VLOG_PROFILE,
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
      ...HIGH_ENERGY_HOOK_PROFILE,
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
    const cuts = agent.buildCandidateCuts(manifest, HIGH_ENERGY_HOOK_PROFILE);
    const sceneCuts = cuts.filter(c => c.reason === 'scene_change');
    expect(sceneCuts.length).toBeGreaterThan(0);
  });

  it('produces cuts from sentence boundaries', () => {
    const manifest = makeManifest();
    const cuts = agent.buildCandidateCuts(manifest, HIGH_ENERGY_HOOK_PROFILE);
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
    const cuts = agent.buildCandidateCuts(manifest, HIGH_ENERGY_HOOK_PROFILE);
    const silenceCuts = cuts.filter(c => c.reason === 'silence_start' || c.reason === 'silence_end');
    expect(silenceCuts.length).toBeGreaterThan(0);
  });

  it('produces mid-sentence cuts when allowMidSentenceCuts is true', () => {
    const manifest = makeManifest();
    const cuts = agent.buildCandidateCuts(manifest, CONTINUOUS_VLOG_PROFILE);
    const midCuts = cuts.filter(c => c.reason === 'mid_sentence');
    expect(midCuts.length).toBeGreaterThan(0);
  });

  it('does NOT produce mid-sentence cuts when allowMidSentenceCuts is false', () => {
    const manifest = makeManifest();
    const cuts = agent.buildCandidateCuts(manifest, HIGH_ENERGY_HOOK_PROFILE);
    const midCuts = cuts.filter(c => c.reason === 'mid_sentence');
    expect(midCuts).toHaveLength(0);
  });

  it('deduplicates cuts within 100ms', () => {
    const manifest = makeManifest();
    const cuts = agent.buildCandidateCuts(manifest, HIGH_ENERGY_HOOK_PROFILE);
    for (let i = 1; i < cuts.length; i++) {
      expect(Math.abs(cuts[i].timestampMs - cuts[i - 1].timestampMs)).toBeGreaterThanOrEqual(100);
    }
  });

  it('returns cuts sorted by timestamp', () => {
    const manifest = makeManifest();
    const cuts = agent.buildCandidateCuts(manifest, HIGH_ENERGY_HOOK_PROFILE);
    for (let i = 1; i < cuts.length; i++) {
      expect(cuts[i].timestampMs).toBeGreaterThanOrEqual(cuts[i - 1].timestampMs);
    }
  });

  it('assigns editIQEnergy to all cuts', () => {
    const manifest = makeManifest();
    const cuts = agent.buildCandidateCuts(manifest, HIGH_ENERGY_HOOK_PROFILE);
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
    const cuts = agent.buildCandidateCuts(manifest, HIGH_ENERGY_HOOK_PROFILE);
    const motionCuts = cuts.filter(c => c.reason === 'motion_peak');
    expect(motionCuts.length).toBeGreaterThan(0);
  });
});

// ─── selectCuts ──────────────────────────────────────────────────────

describe('EditingAgent.selectCuts', () => {
  const agent = new EditingAgent(noopLLM);

  it('dispatches to Progressive Rhythm for High-Energy Hook', () => {
    const manifest = makeManifest();
    const candidates = agent.buildCandidateCuts(manifest, HIGH_ENERGY_HOOK_PROFILE);
    const selected = agent.selectCuts(candidates, manifest, HIGH_ENERGY_HOOK_PROFILE);
    // Should select some cuts, fewer than candidates
    expect(selected.length).toBeGreaterThan(0);
    expect(selected.length).toBeLessThanOrEqual(candidates.length);
  });

  it('dispatches to Continuous Thought for Continuous Vlog', () => {
    const manifest = makeManifest();
    const candidates = agent.buildCandidateCuts(manifest, CONTINUOUS_VLOG_PROFILE);
    const selected = agent.selectCuts(candidates, manifest, CONTINUOUS_VLOG_PROFILE);
    expect(selected.length).toBeGreaterThan(0);
    expect(selected.length).toBeLessThanOrEqual(candidates.length);
  });

  it('selected cuts are chronologically ordered', () => {
    const manifest = makeManifest();
    const candidates = agent.buildCandidateCuts(manifest, HIGH_ENERGY_HOOK_PROFILE);
    const selected = agent.selectCuts(candidates, manifest, HIGH_ENERGY_HOOK_PROFILE);
    for (let i = 1; i < selected.length; i++) {
      expect(selected[i].timestampMs).toBeGreaterThanOrEqual(selected[i - 1].timestampMs);
    }
  });

  it('dispatches to Slow Build for Clean Tech Review', () => {
    const manifest = makeManifest();
    const candidates = agent.buildCandidateCuts(manifest, CLEAN_TECH_REVIEW_PROFILE);
    const selected = agent.selectCuts(candidates, manifest, CLEAN_TECH_REVIEW_PROFILE);
    expect(selected.length).toBeGreaterThanOrEqual(0);
    expect(selected.length).toBeLessThanOrEqual(candidates.length);
  });

  it('dispatches to Chaotic for Rapid Reaction', () => {
    const manifest = makeManifest();
    const candidates = agent.buildCandidateCuts(manifest, RAPID_REACTION_PROFILE);
    const selected = agent.selectCuts(candidates, manifest, RAPID_REACTION_PROFILE);
    expect(selected.length).toBeGreaterThanOrEqual(0);
  });

  it('dispatches to Narrative Arc for Narrative Adventure', () => {
    const manifest = makeManifest();
    const candidates = agent.buildCandidateCuts(manifest, NARRATIVE_ADVENTURE_PROFILE);
    const selected = agent.selectCuts(candidates, manifest, NARRATIVE_ADVENTURE_PROFILE);
    expect(selected.length).toBeGreaterThanOrEqual(0);
    expect(selected.length).toBeLessThanOrEqual(candidates.length);
  });
});

// ─── generateOTIOTimelineDeterministic ───────────────────────────────

describe('EditingAgent.generateOTIOTimelineDeterministic', () => {
  const agent = new EditingAgent(noopLLM);

  it('produces a valid Timeline with name and tracks', () => {
    const manifest = makeManifest();
    const timeline = agent.generateOTIOTimelineDeterministic(manifest, HIGH_ENERGY_HOOK_PROFILE);

    expect(timeline.name).toContain('High-Energy Hook');
    expect(timeline.globalStartTime.rate).toBe(30);
    expect(timeline.tracks).toHaveLength(1);
    expect(timeline.tracks[0].kind).toBe('Video');
  });

  it('first clip has styleTag "Hook"', () => {
    const manifest = makeManifest();
    const timeline = agent.generateOTIOTimelineDeterministic(manifest, HIGH_ENERGY_HOOK_PROFILE);
    expect(timeline.tracks[0].clips[0].styleTag).toBe('Hook');
  });

  it('all clips have positive duration', () => {
    const manifest = makeManifest();
    const timeline = agent.generateOTIOTimelineDeterministic(manifest, HIGH_ENERGY_HOOK_PROFILE);
    for (const clip of timeline.tracks[0].clips) {
      expect(clip.sourceRange.duration.value).toBeGreaterThan(0);
    }
  });

  it('all clips have non-negative start frames', () => {
    const manifest = makeManifest();
    const timeline = agent.generateOTIOTimelineDeterministic(manifest, HIGH_ENERGY_HOOK_PROFILE);
    for (const clip of timeline.tracks[0].clips) {
      expect(clip.sourceRange.startTime.value).toBeGreaterThanOrEqual(0);
    }
  });

  it('clips do not exceed source duration', () => {
    const manifest = makeManifest();
    const timeline = agent.generateOTIOTimelineDeterministic(manifest, HIGH_ENERGY_HOOK_PROFILE);
    const totalFrames = Math.ceil((manifest.durationMs / 1000) * manifest.fps);
    for (const clip of timeline.tracks[0].clips) {
      const endFrame = clip.sourceRange.startTime.value + clip.sourceRange.duration.value;
      expect(endFrame).toBeLessThanOrEqual(totalFrames + 1); // +1 for rounding
    }
  });

  it('clips reference correct source file', () => {
    const manifest = makeManifest();
    const timeline = agent.generateOTIOTimelineDeterministic(manifest, HIGH_ENERGY_HOOK_PROFILE);
    for (const clip of timeline.tracks[0].clips) {
      expect(clip.mediaReference.targetUrl).toBe('test.mp4');
    }
  });

  it('FPS is consistent across all clips', () => {
    const manifest = makeManifest();
    const timeline = agent.generateOTIOTimelineDeterministic(manifest, HIGH_ENERGY_HOOK_PROFILE);
    for (const clip of timeline.tracks[0].clips) {
      expect(clip.sourceRange.startTime.rate).toBe(30);
      expect(clip.sourceRange.duration.rate).toBe(30);
    }
  });

  it('works with Continuous Vlog profile too', () => {
    const manifest = makeManifest();
    const timeline = agent.generateOTIOTimelineDeterministic(manifest, CONTINUOUS_VLOG_PROFILE);
    expect(timeline.name).toContain('Continuous Vlog');
    expect(timeline.tracks[0].clips.length).toBeGreaterThan(0);
  });

  it('handles empty transcript gracefully', () => {
    const manifest = makeManifest({ transcript: [], silentPauses: [] });
    const timeline = agent.generateOTIOTimelineDeterministic(manifest, HIGH_ENERGY_HOOK_PROFILE);
    // Should still produce at least 1 clip (the full duration)
    expect(timeline.tracks[0].clips.length).toBeGreaterThanOrEqual(1);
  });
});

// ─── Slow Build pacing ──────────────────────────────────────────────

describe('Slow Build pacing (Clean Tech Review)', () => {
  const agent = new EditingAgent(noopLLM);

  it('produces a valid timeline', () => {
    const manifest = makeManifest();
    const timeline = agent.generateOTIOTimelineDeterministic(manifest, CLEAN_TECH_REVIEW_PROFILE);
    expect(timeline.tracks[0].clips.length).toBeGreaterThan(0);
    for (const clip of timeline.tracks[0].clips) {
      expect(clip.sourceRange.duration.value).toBeGreaterThan(0);
    }
  });

  it('only selects sentence-aligned or scene-boundary cuts', () => {
    const manifest = makeManifest();
    const candidates = agent.buildCandidateCuts(manifest, CLEAN_TECH_REVIEW_PROFILE);
    const selected = agent.selectCuts(candidates, manifest, CLEAN_TECH_REVIEW_PROFILE);
    for (const cut of selected) {
      expect(['sentence_boundary', 'sentence_start', 'scene_change']).toContain(cut.reason);
    }
  });
});

// ─── Chaotic pacing ─────────────────────────────────────────────────

describe('Chaotic pacing (Rapid Reaction)', () => {
  const agent = new EditingAgent(noopLLM);

  it('produces a valid timeline with many clips', () => {
    // Use a longer manifest to get more cuts
    const manifest = makeManifest({ durationMs: 120000 });
    const timeline = agent.generateOTIOTimelineDeterministic(manifest, RAPID_REACTION_PROFILE);
    expect(timeline.tracks[0].clips.length).toBeGreaterThan(0);
  });

  it('selected cuts respect minimum interval', () => {
    const manifest = makeManifest();
    const candidates = agent.buildCandidateCuts(manifest, RAPID_REACTION_PROFILE);
    const selected = agent.selectCuts(candidates, manifest, RAPID_REACTION_PROFILE);
    const minMs = (RAPID_REACTION_PROFILE.bodyOverrides?.minShotDurationSeconds ?? 1) * 1000;
    for (let i = 1; i < selected.length; i++) {
      const gap = selected[i].timestampMs - selected[i - 1].timestampMs;
      expect(gap).toBeGreaterThanOrEqual(minMs - 1); // -1 for float tolerance
    }
  });
});

// ─── Narrative Arc pacing ───────────────────────────────────────────

describe('Narrative Arc pacing (Narrative Adventure / Long-Form Essay)', () => {
  const agent = new EditingAgent(noopLLM);

  it('produces a valid timeline for Narrative Adventure', () => {
    const manifest = makeManifest();
    const timeline = agent.generateOTIOTimelineDeterministic(manifest, NARRATIVE_ADVENTURE_PROFILE);
    expect(timeline.tracks[0].clips.length).toBeGreaterThan(0);
    for (const clip of timeline.tracks[0].clips) {
      expect(clip.sourceRange.duration.value).toBeGreaterThan(0);
    }
  });

  it('produces a valid timeline for Long-Form Essay', () => {
    const manifest = makeManifest();
    const timeline = agent.generateOTIOTimelineDeterministic(manifest, LONG_FORM_ESSAY_PROFILE);
    expect(timeline.tracks[0].clips.length).toBeGreaterThan(0);
  });

  it('selected cuts are chronologically ordered', () => {
    const manifest = makeManifest();
    const candidates = agent.buildCandidateCuts(manifest, NARRATIVE_ADVENTURE_PROFILE);
    const selected = agent.selectCuts(candidates, manifest, NARRATIVE_ADVENTURE_PROFILE);
    for (let i = 1; i < selected.length; i++) {
      expect(selected[i].timestampMs).toBeGreaterThanOrEqual(selected[i - 1].timestampMs);
    }
  });
});

// ─── All profiles end-to-end ────────────────────────────────────────

describe('All 8 profiles produce valid timelines', () => {
  const agent = new EditingAgent(noopLLM);
  const allProfiles = [
    HIGH_ENERGY_HOOK_PROFILE,
    CONTINUOUS_VLOG_PROFILE,
    CLEAN_TECH_REVIEW_PROFILE,
    RAPID_REACTION_PROFILE,
    CINEMATIC_VLOG_PROFILE,
    FAST_INFORMATIVE_PROFILE,
    NARRATIVE_ADVENTURE_PROFILE,
    LONG_FORM_ESSAY_PROFILE,
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
    expect(STYLE_PROFILES['high-energy-hook']).toBeDefined();
    expect(STYLE_PROFILES['continuous-vlog']).toBeDefined();
    expect(STYLE_PROFILES['clean-tech-review']).toBeDefined();
    expect(STYLE_PROFILES['rapid-reaction']).toBeDefined();
    expect(STYLE_PROFILES['cinematic-vlog']).toBeDefined();
    expect(STYLE_PROFILES['fast-informative']).toBeDefined();
    expect(STYLE_PROFILES['narrative-adventure']).toBeDefined();
    expect(STYLE_PROFILES['long-form-essay']).toBeDefined();
  });

  // Match person/brand identifiers only — not generic words like "vlog".
  const PERSON_NAME_RE =
    /mrbeast|neistat|mkbhd|dobrik|mckinnon|\blinus\b|yes theory|vlog brothers|jimmy donaldson|marques/i;

  it('keys are generic — no person names', () => {
    const keys = Object.keys(STYLE_PROFILES).join(' ');
    expect(keys).not.toMatch(PERSON_NAME_RE);
  });

  it('every profile name is generic — no person names', () => {
    for (const profile of Object.values(STYLE_PROFILES)) {
      expect(profile.name).not.toMatch(PERSON_NAME_RE);
    }
  });
});

// ─── Refine-not-generate LLM path ────────────────────────────────────

/** Records the messages/options it was called with and returns a canned reply. */
function recordingLLM(reply: string) {
  const calls: { messages: any[]; options?: any }[] = [];
  const client: LLMClient = {
    async chat(messages, options) {
      calls.push({ messages, options });
      return reply;
    },
  };
  return { client, calls };
}

describe('generateOTIOTimeline (refine path)', () => {
  it('returns a valid timeline and never re-emits geometry', async () => {
    const manifest = makeManifest();
    const { client, calls } = recordingLLM(JSON.stringify({ refinements: [] }));
    const agent = new EditingAgent(client);

    const base = agent.generateOTIOTimelineDeterministic(manifest, HIGH_ENERGY_HOOK_PROFILE);
    const out = await agent.generateOTIOTimeline(manifest, HIGH_ENERGY_HOOK_PROFILE);

    // Empty refinements → identical clip geometry to the deterministic base.
    expect(out.tracks[0].clips.length).toBe(base.tracks[0].clips.length);
    expect(out.tracks[0].clips[0].sourceRange).toEqual(base.tracks[0].clips[0].sourceRange);
    expect(calls.length).toBe(1);
  });

  it('sends a compact prompt and a small token cap (no full-timeline regeneration)', async () => {
    const manifest = makeManifest();
    const { client, calls } = recordingLLM(JSON.stringify({ refinements: [] }));
    const agent = new EditingAgent(client);

    await agent.generateOTIOTimeline(manifest, HIGH_ENERGY_HOOK_PROFILE);

    const { messages, options } = calls[0];
    const userMsg = messages.find((m: any) => m.role === 'user')!.content as string;
    const sysMsg = messages.find((m: any) => m.role === 'system')!.content as string;

    // Compact per-clip lines, not a word-level transcript dump.
    expect(userMsg).toMatch(/#0 /);
    // System prompt is static (no per-video source filename embedded) → cacheable.
    expect(sysMsg).not.toContain(manifest.sourceFile);
    // Token cap is well below the old 4096 full-timeline budget.
    expect(options.maxTokens).toBeLessThanOrEqual(2048);
  });

  it('applies tag and name refinements by clip index', async () => {
    const manifest = makeManifest();
    const reply = JSON.stringify({
      refinements: [{ i: 0, tag: 'Reveal', name: 'Custom Hook Label' }],
    });
    const { client } = recordingLLM(reply);
    const agent = new EditingAgent(client);

    const out = await agent.generateOTIOTimeline(manifest, HIGH_ENERGY_HOOK_PROFILE);
    expect(out.tracks[0].clips[0].styleTag).toBe('Reveal');
    expect(out.tracks[0].clips[0].name).toBe('Custom Hook Label');
  });

  it('drops a clip when keep is false', async () => {
    const manifest = makeManifest();
    const empty = recordingLLM(JSON.stringify({ refinements: [] }));
    const agentBase = new EditingAgent(empty.client);
    const baseCount = (await agentBase.generateOTIOTimeline(manifest, HIGH_ENERGY_HOOK_PROFILE))
      .tracks[0].clips.length;

    const { client } = recordingLLM(JSON.stringify({ refinements: [{ i: 1, keep: false }] }));
    const agent = new EditingAgent(client);
    const out = await agent.generateOTIOTimeline(manifest, HIGH_ENERGY_HOOK_PROFILE);

    expect(out.tracks[0].clips.length).toBe(baseCount - 1);
  });

  it('never drops every clip even if asked to', async () => {
    const manifest = makeManifest();
    // Refinements drop a large index range; applying must not empty the timeline.
    const refinements = Array.from({ length: 500 }, (_, i) => ({ i, keep: false }));
    const { client } = recordingLLM(JSON.stringify({ refinements }));
    const agent = new EditingAgent(client);

    const out = await agent.generateOTIOTimeline(manifest, HIGH_ENERGY_HOOK_PROFILE);
    expect(out.tracks[0].clips.length).toBeGreaterThan(0);
  });

  it('falls back to the deterministic timeline on malformed JSON', async () => {
    const manifest = makeManifest();
    const { client } = recordingLLM('not json at all <<<');
    const agent = new EditingAgent(client);

    const base = agent.generateOTIOTimelineDeterministic(manifest, HIGH_ENERGY_HOOK_PROFILE);
    const out = await agent.generateOTIOTimeline(manifest, HIGH_ENERGY_HOOK_PROFILE);
    expect(out.tracks[0].clips.length).toBe(base.tracks[0].clips.length);
  });

  it('falls back to the deterministic timeline when the LLM throws', async () => {
    const manifest = makeManifest();
    const throwingLLM: LLMClient = {
      async chat() {
        throw new Error('network down');
      },
    };
    const agent = new EditingAgent(throwingLLM);
    const base = agent.generateOTIOTimelineDeterministic(manifest, HIGH_ENERGY_HOOK_PROFILE);
    const out = await agent.generateOTIOTimeline(manifest, HIGH_ENERGY_HOOK_PROFILE);
    expect(out.tracks[0].clips.length).toBe(base.tracks[0].clips.length);
  });
});

describe('generateOTIOTimelineDeterministic is reproducible', () => {
  it('produces identical timelines (incl. bRoll flags) across runs', () => {
    const agent = new EditingAgent(noopLLM);
    const manifest = makeManifest();
    const a = agent.generateOTIOTimelineDeterministic(manifest, CONTINUOUS_VLOG_PROFILE);
    const b = agent.generateOTIOTimelineDeterministic(manifest, CONTINUOUS_VLOG_PROFILE);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
