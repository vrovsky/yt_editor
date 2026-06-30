import {
  MetadataManifest,
  TranscriptSegment,
  SilentPause,
  SaliencyFrame,
} from '../types/metadata';
import { StyleProfile } from '../types/styleProfile';
import {
  Timeline,
  Track,
  Clip,
  RationalTime,
  TimeRange,
  MediaReference,
} from './otioSchema';
import { validateTimeline } from './timelineValidator';

/** Deterministic pseudo-random unit value in [0, 1) from a string seed
 *  (FNV-1a). Used so the "deterministic" timeline is genuinely reproducible. */
function seededUnit(seed: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

export interface ChatOptions {
  /** Hard cap on completion tokens. Defaults to a small value because the
   *  refine path returns a compact JSON array, not a full timeline. */
  maxTokens?: number;
}

export interface LLMClient {
  chat(messages: ChatMessage[], options?: ChatOptions): Promise<string>;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export class OpenAIClient implements LLMClient {
  private apiKey: string;
  private model: string;
  private baseUrl: string;

  constructor(apiKey: string, model = 'gpt-4o-mini', baseUrl = 'https://api.openai.com/v1') {
    this.apiKey = apiKey;
    this.model = model;
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  async chat(messages: ChatMessage[], options: ChatOptions = {}): Promise<string> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey || 'ollama'}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        temperature: 0.2,
        max_tokens: options.maxTokens ?? 1024,
        response_format: { type: 'json_object' },
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`OpenAI API error ${response.status}: ${errorBody}`);
    }

    const data = (await response.json()) as {
      choices: Array<{ message: { content: string } }>;
    };

    return data.choices[0].message.content;
  }
}

interface CandidateCut {
  timestampMs: number;
  reason: string;
  score: number;
  editIQEnergy?: number;
}

/** A compact per-clip refinement returned by the LLM (keyed by clip index). */
interface ClipRefinement {
  i: number;
  keep?: boolean;
  tag?: string;
  name?: string;
}

interface ProcessedSegment {
  segment: TranscriptSegment;
  keep: boolean;
  adjustedStartMs: number;
  adjustedEndMs: number;
}

function computeEditIQEnergy(
  cutTimestampMs: number,
  manifest: MetadataManifest,
  profile: StyleProfile,
): number {
  const weights = profile.editIQWeights ?? {
    jumpCutPenalty: 0.5,
    sentenceStartReward: 0.5,
    audioTransientReward: 0.3,
    sceneBoundaryReward: 0.5,
    saliencyInterruptPenalty: 0.5,
    facePresenceReward: 0.3,
  };

  let energy = 0;

  const nearestSaliencyBefore = findNearestSaliencyFrame(
    manifest.saliencyMap,
    cutTimestampMs,
    'before',
  );
  const nearestSaliencyAfter = findNearestSaliencyFrame(
    manifest.saliencyMap,
    cutTimestampMs,
    'after',
  );

  if (nearestSaliencyBefore && nearestSaliencyAfter) {
    const dx = nearestSaliencyAfter.focusX - nearestSaliencyBefore.focusX;
    const dy = nearestSaliencyAfter.focusY - nearestSaliencyBefore.focusY;
    const focusDistance = Math.sqrt(dx * dx + dy * dy);
    energy += weights.jumpCutPenalty * focusDistance;
  }

  const SENTENCE_PROXIMITY_MS = 200;
  const nearSentenceStart = manifest.transcript.some(
    (seg) => Math.abs(seg.startMs - cutTimestampMs) < SENTENCE_PROXIMITY_MS,
  );
  if (nearSentenceStart) {
    energy -= weights.sentenceStartReward;
  }

  const TRANSIENT_PROXIMITY_MS = 150;
  const nearBeat = manifest.audioBeats?.some(
    (beat) => Math.abs(beat.timestampMs - cutTimestampMs) < TRANSIENT_PROXIMITY_MS,
  );
  if (nearBeat) {
    energy -= weights.audioTransientReward;
  }

  const SCENE_PROXIMITY_MS = 500;
  const nearestScene = manifest.sceneChanges.find(
    (sc) => Math.abs(sc.timestampMs - cutTimestampMs) < SCENE_PROXIMITY_MS,
  );
  if (nearestScene) {
    energy -= weights.sceneBoundaryReward * nearestScene.score;
  }

  if (nearestSaliencyBefore && nearestSaliencyBefore.saliencyScore > 0.7) {
    energy += weights.saliencyInterruptPenalty * nearestSaliencyBefore.saliencyScore;
  }

  if (nearestSaliencyAfter && nearestSaliencyAfter.hasFace) {
    energy -= weights.facePresenceReward;
  }

  return energy;
}

function findNearestSaliencyFrame(
  saliencyMap: SaliencyFrame[],
  timestampMs: number,
  direction: 'before' | 'after',
): SaliencyFrame | null {
  if (saliencyMap.length === 0) return null;

  if (direction === 'before') {
    let best: SaliencyFrame | null = null;
    for (const frame of saliencyMap) {
      if (frame.timestampMs <= timestampMs) {
        best = frame;
      } else {
        break;
      }
    }
    return best;
  } else {
    for (const frame of saliencyMap) {
      if (frame.timestampMs >= timestampMs) {
        return frame;
      }
    }
    return null;
  }
}

function applyProgressiveRhythm(
  candidateCuts: CandidateCut[],
  manifest: MetadataManifest,
  profile: StyleProfile,
): CandidateCut[] {
  const introEnd = (profile.introOverrides?.durationSeconds ?? 0) * 1000;
  const rampDuration = 10000;
  const rampEnd = introEnd + rampDuration;

  const introDensity = profile.introOverrides?.cutDensityPerMinute ?? profile.cutDensityPerMinute;
  const bodyDensity = profile.cutDensityPerMinute;

  const introIntervalMs = (60 * 1000) / introDensity;
  const bodyIntervalMs = (60 * 1000) / bodyDensity;

  const bodyMinMs = (profile.bodyOverrides?.minShotDurationSeconds ?? 2) * 1000;
  const bodyMaxMs = (profile.bodyOverrides?.maxShotDurationSeconds ?? 10) * 1000;

  const selected: CandidateCut[] = [];
  let lastCutMs = 0;

  for (const cut of candidateCuts) {
    const t = cut.timestampMs;

    let targetIntervalMs: number;
    if (t < introEnd) {
      targetIntervalMs = introIntervalMs;
    } else if (t < rampEnd) {
      const rampProgress = (t - introEnd) / rampDuration;
      targetIntervalMs = introIntervalMs + (bodyIntervalMs - introIntervalMs) * rampProgress;
    } else {
      targetIntervalMs = Math.max(bodyMinMs, Math.min(bodyMaxMs, bodyIntervalMs));
    }

    const timeSinceLastCut = t - lastCutMs;

    const isSceneBoundary = cut.reason === 'scene_change';
    const minInterval = isSceneBoundary
      ? targetIntervalMs * 0.5
      : targetIntervalMs * 0.7;

    if (timeSinceLastCut >= minInterval) {
      const energyThreshold = t < introEnd ? 0.5 : 0.3;
      if (cut.editIQEnergy === undefined || cut.editIQEnergy < energyThreshold) {
        selected.push(cut);
        lastCutMs = t;
      }
    }
  }

  return selected;
}

function applyContinuousThought(
  candidateCuts: CandidateCut[],
  manifest: MetadataManifest,
  profile: StyleProfile,
): CandidateCut[] {
  const targetIntervalMs = (60 * 1000) / profile.cutDensityPerMinute;
  const bodyMinMs = (profile.bodyOverrides?.minShotDurationSeconds ?? 3) * 1000;
  const bodyMaxMs = (profile.bodyOverrides?.maxShotDurationSeconds ?? 15) * 1000;

  const scoredCuts = candidateCuts.map((cut) => {
    let adjustedScore = cut.score;

    const containingSegment = manifest.transcript.find(
      (seg) => seg.startMs <= cut.timestampMs && seg.endMs >= cut.timestampMs,
    );

    if (containingSegment && profile.allowMidSentenceCuts) {
      const segDuration = containingSegment.endMs - containingSegment.startMs;
      const positionInSeg = (cut.timestampMs - containingSegment.startMs) / segDuration;
      if (positionInSeg >= 0.3 && positionInSeg <= 0.7) {
        adjustedScore += 0.3;
      }
    }

    if (cut.reason === 'scene_change') {
      adjustedScore += 0.4;
    }

    return { ...cut, score: adjustedScore };
  });

  scoredCuts.sort((a, b) => b.score - a.score);

  const selected: CandidateCut[] = [];
  let lastCutMs = 0;

  const chronological = [...scoredCuts].sort((a, b) => a.timestampMs - b.timestampMs);

  for (const cut of chronological) {
    const timeSinceLastCut = cut.timestampMs - lastCutMs;
    const effectiveMin = Math.max(bodyMinMs, targetIntervalMs * 0.6);

    if (timeSinceLastCut >= effectiveMin) {
      if (cut.editIQEnergy === undefined || cut.editIQEnergy < 0.4) {
        selected.push(cut);
        lastCutMs = cut.timestampMs;
      }
    }
  }

  return selected;
}

function applySlowBuild(
  candidateCuts: CandidateCut[],
  _manifest: MetadataManifest,
  profile: StyleProfile,
): CandidateCut[] {
  const bodyMinMs = (profile.bodyOverrides?.minShotDurationSeconds ?? 4) * 1000;
  const bodyMaxMs = (profile.bodyOverrides?.maxShotDurationSeconds ?? 8) * 1000;
  const targetIntervalMs = (60 * 1000) / profile.cutDensityPerMinute;

  // Only accept sentence-aligned and scene boundary cuts
  const allowed = candidateCuts.filter(
    (c) =>
      c.reason === 'sentence_boundary' ||
      c.reason === 'sentence_start' ||
      c.reason === 'scene_change',
  );

  const selected: CandidateCut[] = [];
  let lastCutMs = 0;

  for (const cut of allowed) {
    const timeSinceLastCut = cut.timestampMs - lastCutMs;

    if (timeSinceLastCut < bodyMinMs) continue;

    // Strict energy threshold — only accept very clean cuts
    if (cut.editIQEnergy !== undefined && cut.editIQEnergy >= 0.2) continue;

    // Scene boundaries get priority even below target interval
    const isScene = cut.reason === 'scene_change';
    const minRequired = isScene ? bodyMinMs : Math.max(bodyMinMs, targetIntervalMs * 0.8);

    if (timeSinceLastCut >= minRequired) {
      selected.push(cut);
      lastCutMs = cut.timestampMs;
    }
  }

  return selected;
}

function applyChaotic(
  candidateCuts: CandidateCut[],
  _manifest: MetadataManifest,
  profile: StyleProfile,
): CandidateCut[] {
  const minMs = (profile.bodyOverrides?.minShotDurationSeconds ?? 1) * 1000;
  const maxMs = (profile.bodyOverrides?.maxShotDurationSeconds ?? 3) * 1000;

  const selected: CandidateCut[] = [];
  let lastCutMs = 0;

  for (const cut of candidateCuts) {
    const timeSinceLastCut = cut.timestampMs - lastCutMs;

    if (timeSinceLastCut < minMs) continue;

    // Accept nearly everything — chaotic ignores energy
    selected.push(cut);
    lastCutMs = cut.timestampMs;
  }

  // Force-insert cuts if any gap exceeds maxMs
  const withForced: CandidateCut[] = [];
  let prevMs = 0;
  for (const cut of selected) {
    // Fill gaps larger than maxMs with intermediate cuts from the original candidates
    if (cut.timestampMs - prevMs > maxMs) {
      const fillers = candidateCuts.filter(
        (c) => c.timestampMs > prevMs + minMs && c.timestampMs < cut.timestampMs - minMs,
      );
      for (const f of fillers) {
        if (f.timestampMs - prevMs >= minMs) {
          withForced.push(f);
          prevMs = f.timestampMs;
        }
      }
    }
    if (cut.timestampMs - prevMs >= minMs) {
      withForced.push(cut);
      prevMs = cut.timestampMs;
    }
  }

  return withForced;
}

function applyNarrativeArc(
  candidateCuts: CandidateCut[],
  manifest: MetadataManifest,
  profile: StyleProfile,
): CandidateCut[] {
  const totalMs = manifest.durationMs;
  const baseDensity = profile.cutDensityPerMinute;
  const bodyMinMs = (profile.bodyOverrides?.minShotDurationSeconds ?? 5) * 1000;

  // Act boundaries as fractions of total duration
  const acts = [
    { start: 0, end: 0.25, densityMul: 0.6, energyThreshold: 0.15, label: 'setup' },
    { start: 0.25, end: 0.75, densityMul: 1.0, energyThreshold: 0.3, label: 'development' },
    { start: 0.75, end: 0.90, densityMul: 1.4, energyThreshold: 0.5, label: 'climax' },
    { start: 0.90, end: 1.0, densityMul: 0.6, energyThreshold: 0.15, label: 'resolution' },
  ];

  function getAct(timestampMs: number) {
    const progress = timestampMs / totalMs;
    return acts.find((a) => progress >= a.start && progress < a.end) ?? acts[acts.length - 1];
  }

  const selected: CandidateCut[] = [];
  let lastCutMs = 0;

  for (const cut of candidateCuts) {
    const act = getAct(cut.timestampMs);
    const actDensity = baseDensity * act.densityMul;
    const targetIntervalMs = (60 * 1000) / actDensity;
    const timeSinceLastCut = cut.timestampMs - lastCutMs;

    const minInterval = Math.max(bodyMinMs, targetIntervalMs * 0.7);

    if (timeSinceLastCut < minInterval) continue;

    // Energy threshold varies by act — stricter in setup/resolution, relaxed in climax
    if (cut.editIQEnergy !== undefined && cut.editIQEnergy >= act.energyThreshold) continue;

    // In setup and resolution, prefer sentence-aligned cuts
    if (
      (act.label === 'setup' || act.label === 'resolution') &&
      cut.reason !== 'sentence_boundary' &&
      cut.reason !== 'sentence_start' &&
      cut.reason !== 'scene_change'
    ) {
      continue;
    }

    selected.push(cut);
    lastCutMs = cut.timestampMs;
  }

  return selected;
}

export class EditingAgent {
  private llm: LLMClient;

  constructor(llm: LLMClient) {
    this.llm = llm;
  }

  applySilentCuts(
    manifest: MetadataManifest,
    profile: StyleProfile,
  ): ProcessedSegment[] {
    const { transcript, silentPauses } = manifest;

    if (profile.silentCutMode === 'keep') {
      return transcript.map((seg) => ({
        segment: seg,
        keep: true,
        adjustedStartMs: seg.startMs,
        adjustedEndMs: seg.endMs,
      }));
    }

    let cumulativeRemovedMs = 0;
    const processed: ProcessedSegment[] = [];

    for (let i = 0; i < transcript.length; i++) {
      const seg = transcript[i];

      const precedingPauses = silentPauses.filter(
        (p) =>
          p.endMs <= seg.startMs &&
          p.startMs >= (i > 0 ? transcript[i - 1].endMs : 0),
      );

      for (const pause of precedingPauses) {
        if (profile.silentCutMode === 'remove') {
          cumulativeRemovedMs += pause.durationMs;
        } else if (profile.silentCutMode === 'shorten') {
          const excess = Math.max(0, pause.durationMs - profile.maxSilenceMs);
          cumulativeRemovedMs += excess;
        }
      }

      processed.push({
        segment: seg,
        keep: true,
        adjustedStartMs: Math.max(0, seg.startMs - cumulativeRemovedMs),
        adjustedEndMs: Math.max(0, seg.endMs - cumulativeRemovedMs),
      });

      const intraSegmentPauses = silentPauses.filter(
        (p) => p.startMs >= seg.startMs && p.endMs <= seg.endMs,
      );

      for (const pause of intraSegmentPauses) {
        if (profile.silentCutMode === 'remove') {
          cumulativeRemovedMs += pause.durationMs;
        } else if (profile.silentCutMode === 'shorten') {
          const excess = Math.max(0, pause.durationMs - profile.maxSilenceMs);
          cumulativeRemovedMs += excess;
        }
      }
    }

    return processed;
  }

  buildCandidateCuts(
    manifest: MetadataManifest,
    profile: StyleProfile,
  ): CandidateCut[] {
    const cuts: CandidateCut[] = [];

    for (const sc of manifest.sceneChanges) {
      cuts.push({
        timestampMs: sc.timestampMs,
        reason: 'scene_change',
        score: profile.preferSceneBoundaryCuts ? sc.score * 1.5 : sc.score,
      });
    }

    for (const seg of manifest.transcript) {
      cuts.push({
        timestampMs: seg.endMs,
        reason: 'sentence_boundary',
        score: 0.7,
      });
      if (seg.startMs > 0) {
        cuts.push({
          timestampMs: seg.startMs,
          reason: 'sentence_start',
          score: 0.6,
        });
      }

      if (profile.allowMidSentenceCuts && seg.words.length > 3) {
        const midIdx = Math.floor(seg.words.length * 0.5);
        const midWord = seg.words[midIdx];
        cuts.push({
          timestampMs: midWord.startMs,
          reason: 'mid_sentence',
          score: 0.5,
        });
      }
    }

    for (const pause of manifest.silentPauses) {
      cuts.push({
        timestampMs: pause.startMs,
        reason: 'silence_start',
        score: 0.4,
      });
      cuts.push({
        timestampMs: pause.endMs,
        reason: 'silence_end',
        score: 0.5,
      });
    }

    for (let i = 1; i < manifest.saliencyMap.length; i++) {
      const prev = manifest.saliencyMap[i - 1];
      const curr = manifest.saliencyMap[i];
      if (prev.motionMagnitude > 0.5 && curr.motionMagnitude < 0.3) {
        cuts.push({
          timestampMs: curr.timestampMs,
          reason: 'motion_peak',
          score: 0.6,
        });
      }
    }

    cuts.sort((a, b) => a.timestampMs - b.timestampMs);
    const deduped: CandidateCut[] = [];
    for (const cut of cuts) {
      const last = deduped[deduped.length - 1];
      if (last && Math.abs(cut.timestampMs - last.timestampMs) < 100) {
        if (cut.score > last.score) {
          deduped[deduped.length - 1] = cut;
        }
      } else {
        deduped.push(cut);
      }
    }

    for (const cut of deduped) {
      cut.editIQEnergy = computeEditIQEnergy(cut.timestampMs, manifest, profile);
    }

    return deduped;
  }

  selectCuts(
    candidateCuts: CandidateCut[],
    manifest: MetadataManifest,
    profile: StyleProfile,
  ): CandidateCut[] {
    switch (profile.pacingType) {
      case 'Progressive Rhythm':
        return applyProgressiveRhythm(candidateCuts, manifest, profile);
      case 'Continuous Thought':
        return applyContinuousThought(candidateCuts, manifest, profile);
      case 'Slow Build':
        return applySlowBuild(candidateCuts, manifest, profile);
      case 'Chaotic':
        return applyChaotic(candidateCuts, manifest, profile);
      case 'Narrative Arc':
        return applyNarrativeArc(candidateCuts, manifest, profile);
      default:
        return this.genericCutSelection(candidateCuts, manifest, profile);
    }
  }

  private genericCutSelection(
    candidateCuts: CandidateCut[],
    manifest: MetadataManifest,
    profile: StyleProfile,
  ): CandidateCut[] {
    const targetIntervalMs = (60 * 1000) / profile.cutDensityPerMinute;
    const selected: CandidateCut[] = [];
    let lastCutMs = 0;

    for (const cut of candidateCuts) {
      if (cut.timestampMs - lastCutMs >= targetIntervalMs * 0.7) {
        selected.push(cut);
        lastCutMs = cut.timestampMs;
      }
    }

    return selected;
  }

  // ─── Refine-not-generate LLM path ──────────────────────────────────
  //
  // Token-cost note: the deterministic engine already produces a complete,
  // valid OTIO timeline locally for free. The LLM is therefore used only to
  // *refine* that timeline — relabel styleTags/clip names and optionally drop
  // weak clips — by returning a compact JSON array keyed on clip index. We
  // never ask it to re-emit frame geometry. This cuts tokens by ~70-90% vs.
  // regenerating the whole timeline and removes the truncated-JSON failure mode.

  /** Max clips described to the LLM. Beyond this, extra clips keep their
   *  deterministic labels (logged) so the prompt stays bounded. */
  private static readonly MAX_CLIPS_IN_PROMPT = 250;
  /** Per-clip transcript snippet cap (characters). */
  private static readonly CLIP_TEXT_CHARS = 100;

  /** Static, per-style instruction. Contains no per-video data so identical
   *  requests for the same style share a cacheable prompt prefix. */
  private buildRefineSystemPrompt(profile: StyleProfile): string {
    return `You are a video-editing assistant refining a pre-cut timeline for the "${profile.name}" style.

## Style: ${profile.description}
- Pacing: ${profile.pacingType} | target ${profile.cutDensityPerMinute} cuts/min
- B-roll bias: ${Math.round(profile.bRollProbability * 100)}% | transitions: ${profile.preferredTransitions.join(', ')}

## Task
You are given a numbered list of clips that are ALREADY cut with valid timecodes.
Do NOT change any timecodes. For clips that need it, return a refinement that:
- sets a meaningful "tag" (e.g. "Hook", "Reveal", "Emotional Beat", "B-Roll", "Standard"), and/or
- sets a short human "name" (<= 60 chars), and/or
- sets "keep": false to drop a weak/redundant clip (drop sparingly).

Omit any clip you would leave unchanged. Never drop every clip.

## Output (ONLY this JSON object, no prose)
{ "refinements": [ { "i": <clip index>, "keep": <bool, optional>, "tag": "<string, optional>", "name": "<string, optional>" } ] }`;
  }

  /** Compact per-clip summary derived from the deterministic base timeline. */
  private buildRefineUserPrompt(
    base: Timeline,
    manifest: MetadataManifest,
    profile: StyleProfile,
  ): { prompt: string; describedClips: number; totalClips: number } {
    const clips = base.tracks[0]?.clips ?? [];
    const max = EditingAgent.MAX_CLIPS_IN_PROMPT;
    const described = Math.min(clips.length, max);

    const lines: string[] = [];
    for (let i = 0; i < described; i++) {
      const clip = clips[i];
      const rate = clip.sourceRange.startTime.rate || manifest.fps;
      const startS = clip.sourceRange.startTime.value / rate;
      const durS = clip.sourceRange.duration.value / rate;
      const endS = startS + durS;

      const text = manifest.transcript
        .filter(
          (seg) => seg.startMs < endS * 1000 && seg.endMs > startS * 1000,
        )
        .map((seg) => seg.text)
        .join(' ')
        .slice(0, EditingAgent.CLIP_TEXT_CHARS);

      lines.push(
        `#${i} ${startS.toFixed(1)}-${endS.toFixed(1)}s tag=${clip.styleTag ?? 'Standard'} broll=${clip.bRoll ? 1 : 0}${text ? ` "${text}"` : ''}`,
      );
    }

    const prompt = `Clips (${described} of ${clips.length}; ${profile.pacingType} pacing):\n${lines.join('\n')}\n\nReturn the refinements JSON.`;
    return { prompt, describedClips: described, totalClips: clips.length };
  }

  /** Parse the compact refinement response. Returns [] on any malformed input
   *  (caller falls back to the deterministic timeline). */
  private parseRefinements(llmResponse: string): ClipRefinement[] {
    try {
      // Tolerate accidental code fences.
      const cleaned = llmResponse.replace(/```json\s*|\s*```/g, '').trim();
      const parsed = JSON.parse(cleaned) as { refinements?: unknown };
      const arr = Array.isArray(parsed?.refinements) ? parsed.refinements : [];
      const out: ClipRefinement[] = [];
      for (const raw of arr) {
        if (!raw || typeof raw !== 'object') continue;
        const r = raw as Record<string, unknown>;
        if (typeof r.i !== 'number' || !Number.isInteger(r.i) || r.i < 0) continue;
        const ref: ClipRefinement = { i: r.i };
        if (typeof r.keep === 'boolean') ref.keep = r.keep;
        if (typeof r.tag === 'string' && r.tag.trim()) ref.tag = r.tag.slice(0, 60);
        if (typeof r.name === 'string' && r.name.trim()) ref.name = r.name.slice(0, 60);
        out.push(ref);
      }
      return out;
    } catch {
      return [];
    }
  }

  /** Apply refinements to a copy of the base timeline by clip index. */
  private applyRefinements(base: Timeline, refinements: ClipRefinement[]): Timeline {
    const track = base.tracks[0];
    if (!track) return base;

    const byIndex = new Map<number, ClipRefinement>();
    for (const r of refinements) byIndex.set(r.i, r);

    const refined: Clip[] = [];
    track.clips.forEach((clip, i) => {
      const r = byIndex.get(i);
      if (r?.keep === false) return; // drop
      refined.push({
        ...clip,
        styleTag: r?.tag ?? clip.styleTag,
        name: r?.name ?? clip.name,
      });
    });

    // Never let the LLM drop everything.
    const clips = refined.length > 0 ? refined : track.clips;

    return {
      ...base,
      tracks: [{ ...track, clips }, ...base.tracks.slice(1)],
    };
  }

  async generateOTIOTimeline(
    manifest: MetadataManifest,
    profile: StyleProfile,
  ): Promise<Timeline> {
    // 1. Build the deterministic timeline locally (free, always valid).
    const base = this.generateOTIOTimelineDeterministic(manifest, profile);

    // 2. Ask the LLM only to refine labels / drop weak clips (compact I/O).
    const systemPrompt = this.buildRefineSystemPrompt(profile);
    const { prompt: userPrompt, describedClips, totalClips } =
      this.buildRefineUserPrompt(base, manifest, profile);

    if (totalClips > describedClips) {
      console.warn(
        `[generateOTIOTimeline] ${totalClips - describedClips} clip(s) beyond ` +
          `the ${EditingAgent.MAX_CLIPS_IN_PROMPT} prompt cap keep deterministic labels.`,
      );
    }

    // Output is a compact array (~24 tokens/clip), bounded well below the
    // old 4096-token full-timeline regeneration.
    const maxTokens = Math.max(256, Math.min(2048, describedClips * 24));

    let refinements: ClipRefinement[] = [];
    try {
      const llmResponse = await this.llm.chat(
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        { maxTokens },
      );
      refinements = this.parseRefinements(llmResponse);
    } catch (e) {
      console.warn(
        `[generateOTIOTimeline] LLM refine failed, using deterministic timeline: ${(e as Error).message}`,
      );
      return base;
    }

    const refined = this.applyRefinements(base, refinements);

    // 3. Validate before returning; fall back to the base on any violation.
    const fps = manifest.fps;
    const totalFrames = Math.ceil((manifest.durationMs / 1000) * fps);
    const errors = validateTimeline(refined, {
      sourceFile: manifest.sourceFile,
      fps,
      totalFrames,
    });
    if (errors.length > 0) {
      console.warn(
        `[generateOTIOTimeline] refined timeline invalid (${errors.length} error(s)), ` +
          `using deterministic timeline. First: ${errors[0]}`,
      );
      return base;
    }

    return refined;
  }

  generateOTIOTimelineDeterministic(
    manifest: MetadataManifest,
    profile: StyleProfile,
  ): Timeline {
    const processedSegments = this.applySilentCuts(manifest, profile);
    const candidateCuts = this.buildCandidateCuts(manifest, profile);
    const selectedCuts = this.selectCuts(candidateCuts, manifest, profile);

    const fps = manifest.fps;
    const totalFrames = Math.ceil((manifest.durationMs / 1000) * fps);

    const cutTimestamps = [
      0,
      ...selectedCuts.map((c) => c.timestampMs),
      manifest.durationMs,
    ];
    const uniqueCuts = [...new Set(cutTimestamps)].sort((a, b) => a - b);

    const clips: Clip[] = [];
    for (let i = 0; i < uniqueCuts.length - 1; i++) {
      const startMs = uniqueCuts[i];
      const endMs = uniqueCuts[i + 1];
      const startFrame = Math.round((startMs / 1000) * fps);
      const durationFrames = Math.round(((endMs - startMs) / 1000) * fps);

      if (durationFrames <= 0) continue;

      const overlappingSegments = processedSegments.filter(
        (ps) => ps.segment.startMs < endMs && ps.segment.endMs > startMs,
      );
      const clipText =
        overlappingSegments
          .map((ps) => ps.segment.text)
          .join(' ')
          .slice(0, 60) || `Clip ${i + 1}`;

      let styleTag = 'Standard';
      const isIntroZone =
        profile.introOverrides &&
        startMs < profile.introOverrides.durationSeconds * 1000;

      if (i === 0) {
        styleTag = 'Hook';
      } else if (isIntroZone) {
        styleTag = 'High Energy Intro';
      } else {
        const avgSaliency = manifest.saliencyMap
          .filter((f) => f.timestampMs >= startMs && f.timestampMs <= endMs)
          .reduce((sum, f, _, arr) =>
            arr.length > 0 ? sum + f.saliencyScore / arr.length : 0, 0);

        if (avgSaliency > 0.7) styleTag = 'High Saliency';
        else if (durationFrames / fps > 5) styleTag = 'Breathing Room';
      }

      const hasFaceInRange = manifest.saliencyMap.some(
        (f) => f.timestampMs >= startMs && f.timestampMs <= endMs && f.hasFace,
      );
      // Seeded (not Math.random) so this path is actually reproducible:
      // the same manifest + profile always yields the same B-roll decisions.
      const bRollRoll = seededUnit(`${manifest.sourceFile}:${profile.name}:${i}`);
      const isBRoll =
        !hasFaceInRange &&
        bRollRoll < (profile.associativeCutProbability ?? profile.bRollProbability);

      clips.push({
        name: clipText,
        sourceRange: {
          startTime: { value: startFrame, rate: fps },
          duration: { value: durationFrames, rate: fps },
        },
        mediaReference: {
          targetUrl: manifest.sourceFile,
          availableRange: {
            startTime: { value: 0, rate: fps },
            duration: { value: totalFrames, rate: fps },
          },
        },
        bRoll: isBRoll,
        styleTag,
      });
    }

    return {
      name: `${profile.name} Style Edit – ${manifest.sourceFile}`,
      globalStartTime: { value: 0, rate: fps },
      tracks: [
        {
          name: 'V1 – Primary',
          kind: 'Video',
          clips,
        },
      ],
    };
  }
}
