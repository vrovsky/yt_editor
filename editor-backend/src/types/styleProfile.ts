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

export const STYLE_PROFILES: Record<string, StyleProfile> = {
  mrbeast: MRBEAST_PROFILE,
  'casey neistat': CASEY_NEISTAT_PROFILE,
  casey: CASEY_NEISTAT_PROFILE,
};
