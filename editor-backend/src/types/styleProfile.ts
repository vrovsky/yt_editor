export type PacingType =
  | 'Progressive Rhythm'
  | 'Continuous Thought'
  | 'Slow Build'
  | 'Chaotic'
  | 'Narrative Arc';

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

export const MRBEAST_PROFILE: StyleProfile = {
  name: 'MrBeast',
  description:
    'Rhythm-Locked: 38 cuts/min in hook aligned to musical transients, ' +
    'widening to 20-40s shots in body.',
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

export const CASEY_NEISTAT_PROFILE: StyleProfile = {
  name: 'Casey Neistat',
  description:
    'Continuous Thought: mid-sentence location jumps, associative B-roll, ' +
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

export const MKBHD_PROFILE: StyleProfile = {
  name: 'MKBHD',
  description:
    'Slow Build: clean sentence-aligned cuts, informative pacing, strong visual consistency.',
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

export const DAVID_DOBRIK_PROFILE: StyleProfile = {
  name: 'David Dobrik',
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

export const PETER_MCKINNON_PROFILE: StyleProfile = {
  name: 'Peter McKinnon',
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

export const LINUS_TECH_TIPS_PROFILE: StyleProfile = {
  name: 'Linus Tech Tips',
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

export const YES_THEORY_PROFILE: StyleProfile = {
  name: 'Yes Theory',
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

export const VLOG_BROTHERS_PROFILE: StyleProfile = {
  name: 'Vlog Brothers',
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

export const STYLE_PROFILES: Record<string, StyleProfile> = {
  mrbeast: MRBEAST_PROFILE,
  'casey neistat': CASEY_NEISTAT_PROFILE,
  casey: CASEY_NEISTAT_PROFILE,
  mkbhd: MKBHD_PROFILE,
  'david dobrik': DAVID_DOBRIK_PROFILE,
  'peter mckinnon': PETER_MCKINNON_PROFILE,
  'linus tech tips': LINUS_TECH_TIPS_PROFILE,
  linus: LINUS_TECH_TIPS_PROFILE,
  'yes theory': YES_THEORY_PROFILE,
  'vlog brothers': VLOG_BROTHERS_PROFILE,
};
