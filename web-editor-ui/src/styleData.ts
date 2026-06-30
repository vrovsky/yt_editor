/**
 * styleData.ts – Editing-style archetypes for the AI Video Editor.
 *
 * Each profile is a generic editing-pacing archetype. Profiles are NOT
 * affiliated with, endorsed by, or representative of any individual
 * creator. The `id` is the public API contract sent to the backend as
 * the `style` field and must stay in sync with STYLE_PROFILES keys in
 * editor-backend/src/types/styleProfile.ts.
 */

export type PacingType =
  | 'Progressive Rhythm'
  | 'Continuous Thought'
  | 'Slow Build'
  | 'Chaotic'
  | 'Narrative Arc';

export interface EditIQWeights {
  jumpCutPenalty: number;
  sentenceStartReward: number;
  audioTransientReward: number;
  sceneBoundaryReward: number;
  saliencyInterruptPenalty: number;
  facePresenceReward: number;
}

export interface StyleProfile {
  name: string;
  description: string;
  cutDensityPerMinute: number;
  visualResetIntervalSeconds: number;
  pacingType: PacingType;
  bRollProbability: number;
  preferredTransitions: string[];
  silentCutMode: 'remove' | 'shorten' | 'keep';
  maxSilenceMs: number;
  preferSceneBoundaryCuts: boolean;
  allowMidSentenceCuts?: boolean;
  associativeCutProbability?: number;
  introOverrides?: {
    durationSeconds: number;
    cutDensityPerMinute: number;
    visualResetIntervalSeconds: number;
  };
  bodyOverrides?: {
    minShotDurationSeconds: number;
    maxShotDurationSeconds: number;
  };
  editIQWeights?: EditIQWeights;
}

export interface YouTuberProfile {
  /** Stable preset id — sent to the backend as the `style` field. */
  id: string;
  name: string;
  avatar: string;
  accentColor: string;
  gradientFrom: string;
  gradientTo: string;
  tags: string[];
  description: string;
  cutDensityLabel: string;
  styleProfile: StyleProfile;
}

export const YOUTUBER_PROFILES: YouTuberProfile[] = [
  {
    id: 'high-energy-hook',
    name: 'High-Energy Hook',
    avatar: '🔥',
    accentColor: '#f59e0b',
    gradientFrom: '#f59e0b',
    gradientTo: '#ef4444',
    tags: ['High Energy', 'Jump Cuts', 'Hook-Focused'],
    description: 'Aggressive cutting — 38 cuts/min in the hook, 20–40s narrative segments in the body. Every second is earned.',
    cutDensityLabel: '38/min hook · 18/min body',
    styleProfile: {
      name: 'High-Energy Hook',
      description: 'Rhythm-locked: ~38 cuts/min in hook aligned to musical transients, widening to 20-40s shots in body.',
      cutDensityPerMinute: 18,
      visualResetIntervalSeconds: 15,
      pacingType: 'Progressive Rhythm',
      bRollProbability: 0.4,
      preferredTransitions: ['hard cut', 'jump cut', 'whip pan', 'zoom punch'],
      silentCutMode: 'remove',
      maxSilenceMs: 0,
      preferSceneBoundaryCuts: false,
      introOverrides: { durationSeconds: 30, cutDensityPerMinute: 38, visualResetIntervalSeconds: 6 },
      bodyOverrides: { minShotDurationSeconds: 20, maxShotDurationSeconds: 40 },
      editIQWeights: {
        jumpCutPenalty: 0.8, sentenceStartReward: 0.6, audioTransientReward: 0.9,
        sceneBoundaryReward: 0.5, saliencyInterruptPenalty: 0.9, facePresenceReward: 0.4,
      },
    },
  },
  {
    id: 'continuous-vlog',
    name: 'Continuous Vlog',
    avatar: '🎥',
    accentColor: '#3b82f6',
    gradientFrom: '#3b82f6',
    gradientTo: '#8b5cf6',
    tags: ['Cinematic', 'Mid-Sentence Cuts', 'B-Roll Heavy'],
    description: 'Continuous thought — cuts in the middle of sentences, B-roll breaks the location, natural 12/min rhythm.',
    cutDensityLabel: '12/min · natural cadence',
    styleProfile: {
      name: 'Continuous Vlog',
      description: 'Continuous Thought: mid-sentence location jumps, associative B-roll, natural cadence preserved.',
      cutDensityPerMinute: 12,
      visualResetIntervalSeconds: 20,
      pacingType: 'Continuous Thought',
      bRollProbability: 0.6,
      preferredTransitions: ['hard cut', 'match cut', 'L-cut', 'J-cut'],
      silentCutMode: 'shorten',
      maxSilenceMs: 250,
      preferSceneBoundaryCuts: true,
      allowMidSentenceCuts: true,
      associativeCutProbability: 0.6,
      bodyOverrides: { minShotDurationSeconds: 3, maxShotDurationSeconds: 15 },
      editIQWeights: {
        jumpCutPenalty: 0.2, sentenceStartReward: 0.3, audioTransientReward: 0.5,
        sceneBoundaryReward: 0.9, saliencyInterruptPenalty: 0.4, facePresenceReward: 0.8,
      },
    },
  },
  {
    id: 'clean-tech-review',
    name: 'Clean Tech Review',
    avatar: '📱',
    accentColor: '#10b981',
    gradientFrom: '#10b981',
    gradientTo: '#06b6d4',
    tags: ['Slow Build', 'Clean Cuts', 'Informative'],
    description: 'Slow narrative with clean transitions. Each clip is a complete sentence. 10 cuts/min, 4–8s per clip.',
    cutDensityLabel: '10/min · 4–8s per clip',
    styleProfile: {
      name: 'Clean Tech Review',
      description: 'Slow Build: clean sentence-aligned cuts, informative pacing, strong visual consistency.',
      cutDensityPerMinute: 10,
      visualResetIntervalSeconds: 30,
      pacingType: 'Slow Build',
      bRollProbability: 0.3,
      preferredTransitions: ['hard cut', 'dissolve'],
      silentCutMode: 'shorten',
      maxSilenceMs: 300,
      preferSceneBoundaryCuts: true,
      allowMidSentenceCuts: false,
      bodyOverrides: { minShotDurationSeconds: 4, maxShotDurationSeconds: 8 },
      editIQWeights: {
        jumpCutPenalty: 0.9, sentenceStartReward: 0.9, audioTransientReward: 0.3,
        sceneBoundaryReward: 0.7, saliencyInterruptPenalty: 0.6, facePresenceReward: 0.6,
      },
    },
  },
  {
    id: 'rapid-reaction',
    name: 'Rapid Reaction',
    avatar: '⚡',
    accentColor: '#ef4444',
    gradientFrom: '#ef4444',
    gradientTo: '#f97316',
    tags: ['Chaotic', 'Ultra-Fast', 'Reaction'],
    description: 'Chaotic editing without pauses — 60+ cuts/min. Every clip is a reaction or a punch line.',
    cutDensityLabel: '60+/min · 1–2s per clip',
    styleProfile: {
      name: 'Rapid Reaction',
      description: 'Chaotic: ultra-fast cuts, no breathing room, pure reaction-to-reaction editing.',
      cutDensityPerMinute: 60,
      visualResetIntervalSeconds: 5,
      pacingType: 'Chaotic',
      bRollProbability: 0.2,
      preferredTransitions: ['jump cut', 'hard cut'],
      silentCutMode: 'remove',
      maxSilenceMs: 0,
      preferSceneBoundaryCuts: false,
      bodyOverrides: { minShotDurationSeconds: 1, maxShotDurationSeconds: 3 },
      editIQWeights: {
        jumpCutPenalty: 0.1, sentenceStartReward: 0.2, audioTransientReward: 0.7,
        sceneBoundaryReward: 0.3, saliencyInterruptPenalty: 0.2, facePresenceReward: 0.9,
      },
    },
  },
  {
    id: 'cinematic-vlog',
    name: 'Cinematic Vlog',
    avatar: '🎞',
    accentColor: '#ec4899',
    gradientFrom: '#ec4899',
    gradientTo: '#a855f7',
    tags: ['Cinematic', 'Whip Pans', 'Colour Graded'],
    description: 'Cinematic transitions, whip-pan location changes, carefully calibrated rhythm at 15 cuts/min.',
    cutDensityLabel: '15/min · cinematic pacing',
    styleProfile: {
      name: 'Cinematic Vlog',
      description: 'Cinematic vlog with whip pans, match cuts, and carefully timed beat-aligned transitions.',
      cutDensityPerMinute: 15,
      visualResetIntervalSeconds: 20,
      pacingType: 'Continuous Thought',
      bRollProbability: 0.5,
      preferredTransitions: ['whip pan', 'match cut', 'hard cut', 'smash cut'],
      silentCutMode: 'shorten',
      maxSilenceMs: 200,
      preferSceneBoundaryCuts: true,
      allowMidSentenceCuts: true,
      bodyOverrides: { minShotDurationSeconds: 3, maxShotDurationSeconds: 10 },
      editIQWeights: {
        jumpCutPenalty: 0.4, sentenceStartReward: 0.5, audioTransientReward: 0.8,
        sceneBoundaryReward: 0.8, saliencyInterruptPenalty: 0.6, facePresenceReward: 0.7,
      },
    },
  },
  {
    id: 'fast-informative',
    name: 'Fast Informative',
    avatar: '🖥',
    accentColor: '#6366f1',
    gradientFrom: '#6366f1',
    gradientTo: '#3b82f6',
    tags: ['Informative', 'Demo-Focused', 'Clean'],
    description: 'Fast but structured editing for tech content. 20 cuts/min, emphasis on product demonstration.',
    cutDensityLabel: '20/min · demo-first',
    styleProfile: {
      name: 'Fast Informative',
      description: 'Fast informative cuts with B-roll focus on the product being demonstrated.',
      cutDensityPerMinute: 20,
      visualResetIntervalSeconds: 12,
      pacingType: 'Progressive Rhythm',
      bRollProbability: 0.5,
      preferredTransitions: ['hard cut', 'jump cut'],
      silentCutMode: 'remove',
      maxSilenceMs: 100,
      preferSceneBoundaryCuts: false,
      bodyOverrides: { minShotDurationSeconds: 2, maxShotDurationSeconds: 8 },
      editIQWeights: {
        jumpCutPenalty: 0.5, sentenceStartReward: 0.7, audioTransientReward: 0.4,
        sceneBoundaryReward: 0.5, saliencyInterruptPenalty: 0.7, facePresenceReward: 0.3,
      },
    },
  },
  {
    id: 'narrative-adventure',
    name: 'Narrative Adventure',
    avatar: '🌍',
    accentColor: '#14b8a6',
    gradientFrom: '#14b8a6',
    gradientTo: '#10b981',
    tags: ['Adventure', 'Narrative Arc', 'Emotional'],
    description: 'Adventure narrative editing. Emotional beats, 20 cuts/min, long narrative segments that build to a peak.',
    cutDensityLabel: '20/min · narrative arc',
    styleProfile: {
      name: 'Narrative Adventure',
      description: 'Adventure narrative with emotional beats and long narrative segments building to a climax.',
      cutDensityPerMinute: 20,
      visualResetIntervalSeconds: 25,
      pacingType: 'Narrative Arc',
      bRollProbability: 0.45,
      preferredTransitions: ['dissolve', 'hard cut', 'L-cut'],
      silentCutMode: 'shorten',
      maxSilenceMs: 400,
      preferSceneBoundaryCuts: true,
      allowMidSentenceCuts: false,
      bodyOverrides: { minShotDurationSeconds: 5, maxShotDurationSeconds: 20 },
      editIQWeights: {
        jumpCutPenalty: 0.7, sentenceStartReward: 0.7, audioTransientReward: 0.5,
        sceneBoundaryReward: 0.8, saliencyInterruptPenalty: 0.8, facePresenceReward: 0.7,
      },
    },
  },
  {
    id: 'long-form-essay',
    name: 'Long-Form Essay',
    avatar: '📚',
    accentColor: '#8b5cf6',
    gradientFrom: '#8b5cf6',
    gradientTo: '#6366f1',
    tags: ['Narrative', 'Long Takes', 'Intellectual'],
    description: 'Slow intellectual narrative. 8 cuts/min, long uninterrupted thought segments with no B-roll.',
    cutDensityLabel: '8/min · slow narrative',
    styleProfile: {
      name: 'Long-Form Essay',
      description: 'Slow intellectual narrative with long takes and minimal B-roll. Story over aesthetics.',
      cutDensityPerMinute: 8,
      visualResetIntervalSeconds: 45,
      pacingType: 'Narrative Arc',
      bRollProbability: 0.15,
      preferredTransitions: ['hard cut', 'dissolve'],
      silentCutMode: 'keep',
      maxSilenceMs: 600,
      preferSceneBoundaryCuts: true,
      allowMidSentenceCuts: false,
      bodyOverrides: { minShotDurationSeconds: 8, maxShotDurationSeconds: 30 },
      editIQWeights: {
        jumpCutPenalty: 0.9, sentenceStartReward: 0.9, audioTransientReward: 0.2,
        sceneBoundaryReward: 0.6, saliencyInterruptPenalty: 0.8, facePresenceReward: 0.5,
      },
    },
  },
];
