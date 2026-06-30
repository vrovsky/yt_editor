export type PacingType =
  | 'Progressive Rhythm'
  | 'Continuous Thought'
  | 'Slow Build'
  | 'Chaotic'
  | 'Narrative Arc';

export interface StyleProfile {
  /** Generic, descriptive archetype name. Never references a real person. */
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
  introOverrides?: {
    durationSeconds: number;
    cutDensityPerMinute: number;
    visualResetIntervalSeconds: number;
  };
  bodyOverrides?: {
    minShotDurationSeconds: number;
    maxShotDurationSeconds: number;
  };
  allowMidSentenceCuts?: boolean;
  associativeCutProbability?: number;
  editIQWeights?: {
    jumpCutPenalty: number;
    sentenceStartReward: number;
    audioTransientReward: number;
    sceneBoundaryReward: number;
    saliencyInterruptPenalty: number;
    facePresenceReward: number;
  };
}

// ─────────────────────────────────────────────────────────────────────
// Style presets are generic editing-pacing archetypes. They are NOT
// affiliated with, endorsed by, or representative of any individual
// creator. Names describe the editing technique only.
// ─────────────────────────────────────────────────────────────────────

export const HIGH_ENERGY_HOOK_PROFILE: StyleProfile = {
  name: 'High-Energy Hook',
  description:
    'Rhythm-locked: ~38 cuts/min in the hook aligned to musical transients, ' +
    'widening to 20-40s shots in the body.',
  cutDensityPerMinute: 18,
  visualResetIntervalSeconds: 15,
  pacingType: 'Progressive Rhythm',
  bRollProbability: 0.4,
  preferredTransitions: ['hard cut', 'jump cut', 'whip pan', 'zoom punch'],
  silentCutMode: 'remove',
  maxSilenceMs: 0,
  preferSceneBoundaryCuts: false,
  introOverrides: {
    durationSeconds: 30,
    cutDensityPerMinute: 38,
    visualResetIntervalSeconds: 6,
  },
  bodyOverrides: {
    minShotDurationSeconds: 20,
    maxShotDurationSeconds: 40,
  },
  editIQWeights: {
    jumpCutPenalty: 0.8,
    sentenceStartReward: 0.6,
    audioTransientReward: 0.9,
    sceneBoundaryReward: 0.5,
    saliencyInterruptPenalty: 0.9,
    facePresenceReward: 0.4,
  },
};

export const CONTINUOUS_VLOG_PROFILE: StyleProfile = {
  name: 'Continuous Vlog',
  description:
    'Continuous thought: mid-sentence location jumps, associative B-roll, ' +
    'natural cadence preserved.',
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
  bodyOverrides: {
    minShotDurationSeconds: 3,
    maxShotDurationSeconds: 15,
  },
  editIQWeights: {
    jumpCutPenalty: 0.2,
    sentenceStartReward: 0.3,
    audioTransientReward: 0.5,
    sceneBoundaryReward: 0.9,
    saliencyInterruptPenalty: 0.4,
    facePresenceReward: 0.8,
  },
};

export const CLEAN_TECH_REVIEW_PROFILE: StyleProfile = {
  name: 'Clean Tech Review',
  description:
    'Slow build: clean sentence-aligned cuts, informative pacing, strong visual consistency.',
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
    jumpCutPenalty: 0.9,
    sentenceStartReward: 0.9,
    audioTransientReward: 0.3,
    sceneBoundaryReward: 0.7,
    saliencyInterruptPenalty: 0.6,
    facePresenceReward: 0.6,
  },
};

export const RAPID_REACTION_PROFILE: StyleProfile = {
  name: 'Rapid Reaction',
  description:
    'Chaotic: ultra-fast cuts, no breathing room, pure reaction-to-reaction editing.',
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
    jumpCutPenalty: 0.1,
    sentenceStartReward: 0.2,
    audioTransientReward: 0.7,
    sceneBoundaryReward: 0.3,
    saliencyInterruptPenalty: 0.2,
    facePresenceReward: 0.9,
  },
};

export const CINEMATIC_VLOG_PROFILE: StyleProfile = {
  name: 'Cinematic Vlog',
  description:
    'Cinematic vlog with whip pans, match cuts, and carefully timed beat-aligned transitions.',
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
    jumpCutPenalty: 0.4,
    sentenceStartReward: 0.5,
    audioTransientReward: 0.8,
    sceneBoundaryReward: 0.8,
    saliencyInterruptPenalty: 0.6,
    facePresenceReward: 0.7,
  },
};

export const FAST_INFORMATIVE_PROFILE: StyleProfile = {
  name: 'Fast Informative',
  description:
    'Fast informative cuts with B-roll focus on the product being demonstrated.',
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
    jumpCutPenalty: 0.5,
    sentenceStartReward: 0.7,
    audioTransientReward: 0.4,
    sceneBoundaryReward: 0.5,
    saliencyInterruptPenalty: 0.7,
    facePresenceReward: 0.3,
  },
};

export const NARRATIVE_ADVENTURE_PROFILE: StyleProfile = {
  name: 'Narrative Adventure',
  description:
    'Adventure narrative with emotional beats and long narrative segments building to a climax.',
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
    jumpCutPenalty: 0.7,
    sentenceStartReward: 0.7,
    audioTransientReward: 0.5,
    sceneBoundaryReward: 0.8,
    saliencyInterruptPenalty: 0.8,
    facePresenceReward: 0.7,
  },
};

export const LONG_FORM_ESSAY_PROFILE: StyleProfile = {
  name: 'Long-Form Essay',
  description:
    'Slow intellectual narrative with long takes and minimal B-roll. Story over aesthetics.',
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
    jumpCutPenalty: 0.9,
    sentenceStartReward: 0.9,
    audioTransientReward: 0.2,
    sceneBoundaryReward: 0.6,
    saliencyInterruptPenalty: 0.8,
    facePresenceReward: 0.5,
  },
};

/**
 * Keyed by stable, generic preset id. These ids form the public API
 * contract with the frontend (which sends the selected preset id as
 * the `style` field). No id references a real person.
 */
export const STYLE_PROFILES: Record<string, StyleProfile> = {
  'high-energy-hook': HIGH_ENERGY_HOOK_PROFILE,
  'continuous-vlog': CONTINUOUS_VLOG_PROFILE,
  'clean-tech-review': CLEAN_TECH_REVIEW_PROFILE,
  'rapid-reaction': RAPID_REACTION_PROFILE,
  'cinematic-vlog': CINEMATIC_VLOG_PROFILE,
  'fast-informative': FAST_INFORMATIVE_PROFILE,
  'narrative-adventure': NARRATIVE_ADVENTURE_PROFILE,
  'long-form-essay': LONG_FORM_ESSAY_PROFILE,
};
