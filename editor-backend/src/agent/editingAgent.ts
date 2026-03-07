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

export interface LLMClient {
  chat(messages: ChatMessage[]): Promise<string>;
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

  async chat(messages: ChatMessage[]): Promise<string> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey || 'ollama'}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        temperature: 0.3,
        max_tokens: 4096,
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
        adjustedStartMs: seg.startMs - cumulativeRemovedMs,
        adjustedEndMs: seg.endMs - cumulativeRemovedMs,
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

  private buildSystemPrompt(profile: StyleProfile): string {
    const editIQDesc = profile.editIQWeights
      ? `\n## EditIQ Weights
- Jump cut penalty: ${profile.editIQWeights.jumpCutPenalty}
- Sentence start reward: ${profile.editIQWeights.sentenceStartReward}
- Audio transient reward: ${profile.editIQWeights.audioTransientReward}
- Scene boundary reward: ${profile.editIQWeights.sceneBoundaryReward}
- Saliency interrupt penalty: ${profile.editIQWeights.saliencyInterruptPenalty}
- Face presence reward: ${profile.editIQWeights.facePresenceReward}`
      : '';

    return `You are an expert video editor AI implementing the "${profile.name}" editing style.

## Style: ${profile.description}

## Parameters
- Cut density: ${profile.cutDensityPerMinute} cuts/min
- Visual reset: every ${profile.visualResetIntervalSeconds}s
- Pacing: ${profile.pacingType}
- B-roll probability: ${profile.bRollProbability * 100}%
- Transitions: ${profile.preferredTransitions.join(', ')}
- Silent cut: ${profile.silentCutMode}${profile.silentCutMode === 'shorten' ? ` (max ${profile.maxSilenceMs}ms)` : ''}
- Mid-sentence cuts: ${profile.allowMidSentenceCuts ? 'YES' : 'NO'}
${profile.introOverrides ? `- HOOK ZONE (first ${profile.introOverrides.durationSeconds}s): ${profile.introOverrides.cutDensityPerMinute} cuts/min, visual reset every ${profile.introOverrides.visualResetIntervalSeconds}s` : ''}
${profile.bodyOverrides ? `- BODY: ${profile.bodyOverrides.minShotDurationSeconds}-${profile.bodyOverrides.maxShotDurationSeconds}s per shot` : ''}
${editIQDesc}

## Output Format
Return a valid JSON object matching this OTIO Timeline schema:
{
  "name": "string",
  "globalStartTime": { "value": 0, "rate": <fps> },
  "tracks": [{
    "name": "string",
    "kind": "Video" | "Audio",
    "clips": [{
      "name": "string",
      "sourceRange": {
        "startTime": { "value": <frame>, "rate": <fps> },
        "duration": { "value": <frames>, "rate": <fps> }
      },
      "mediaReference": {
        "targetUrl": "string",
        "availableRange": { "startTime": { "value": 0, "rate": <fps> }, "duration": { "value": <total_frames>, "rate": <fps> } }
      },
      "bRoll": boolean,
      "styleTag": "string"
    }]
  }]
}

## Rules
1. Every clip's sourceRange must reference valid timecodes from the source.
2. Mark "Must Keep" segments with styleTag: "Hook", "Reveal", "Emotional Beat", etc.
3. Respect the EditIQ energy scores – prefer low-energy cut points.
4. For "${profile.pacingType}" pacing, follow the algorithm constraints.
5. Return ONLY the JSON object.`;
  }

  private buildUserPrompt(
    manifest: MetadataManifest,
    profile: StyleProfile,
    processedSegments: ProcessedSegment[],
    selectedCuts: CandidateCut[],
  ): string {
    const totalSeconds = manifest.durationMs / 1000;
    const targetClipCount = Math.ceil(
      (totalSeconds / 60) * profile.cutDensityPerMinute,
    );

    const fullTranscript = manifest.transcript
      .map(
        (seg) =>
          `[${(seg.startMs / 1000).toFixed(1)}s-${(seg.endMs / 1000).toFixed(1)}s] ${seg.text}`,
      )
      .join('\n');

    const sceneChangeSummary = manifest.sceneChanges
      .map(
        (sc) =>
          `  F${sc.frameNumber} (${(sc.timestampMs / 1000).toFixed(2)}s) score=${sc.score.toFixed(2)}`,
      )
      .join('\n');

    const selectedCutsSummary = selectedCuts
      .map(
        (c) =>
          `  ${(c.timestampMs / 1000).toFixed(2)}s [${c.reason}] score=${c.score.toFixed(2)} energy=${(c.editIQEnergy ?? 0).toFixed(3)}`,
      )
      .join('\n');

    const highSaliency = manifest.saliencyMap
      .filter((f) => f.saliencyScore > 0.7)
      .slice(0, 20)
      .map(
        (f) =>
          `  F${f.frameNumber} (${(f.timestampMs / 1000).toFixed(2)}s) sal=${f.saliencyScore.toFixed(2)} motion=${f.motionMagnitude.toFixed(2)} face=${f.hasFace}`,
      )
      .join('\n');

    return `## Source Media
- File: ${manifest.sourceFile}
- Duration: ${totalSeconds.toFixed(1)}s | FPS: ${manifest.fps} | ${manifest.width}x${manifest.height}
- Target clips: ~${targetClipCount}

## Transcript
${fullTranscript}

## Scene Changes (${manifest.sceneChanges.length})
${sceneChangeSummary}

## Selected Cut Points (${selectedCuts.length}, pre-filtered by ${profile.pacingType})
${selectedCutsSummary}

## High-Saliency Moments
${highSaliency}

Generate the OTIO Timeline JSON. Source file: "${manifest.sourceFile}", FPS: ${manifest.fps}, total frames: ${Math.ceil(totalSeconds * manifest.fps)}.
Values are in FRAMES. Mark "Must Keep" segments with appropriate styleTags.`;
  }

  private parseOTIOResponse(llmResponse: string): Timeline {
    let timeline: Timeline;
    try {
      timeline = JSON.parse(llmResponse) as Timeline;
    } catch (e) {
      throw new Error(
        `Failed to parse LLM response as OTIO Timeline JSON: ${(e as Error).message}\n\nRaw response:\n${llmResponse.slice(0, 500)}`,
      );
    }

    if (!timeline.name || !timeline.tracks || !Array.isArray(timeline.tracks)) {
      throw new Error(
        'Invalid OTIO Timeline: missing required fields (name, tracks)',
      );
    }

    for (const track of timeline.tracks) {
      if (!track.clips || !Array.isArray(track.clips)) {
        throw new Error(
          `Invalid OTIO Track "${track.name}": missing clips array`,
        );
      }
      for (const clip of track.clips) {
        if (!clip.sourceRange || !clip.mediaReference) {
          throw new Error(
            `Invalid OTIO Clip "${clip.name}": missing sourceRange or mediaReference`,
          );
        }
      }
    }

    return timeline;
  }

  async generateOTIOTimeline(
    manifest: MetadataManifest,
    profile: StyleProfile,
  ): Promise<Timeline> {
    const processedSegments = this.applySilentCuts(manifest, profile);
    const candidateCuts = this.buildCandidateCuts(manifest, profile);
    const selectedCuts = this.selectCuts(candidateCuts, manifest, profile);

    const systemPrompt = this.buildSystemPrompt(profile);
    const userPrompt = this.buildUserPrompt(
      manifest,
      profile,
      processedSegments,
      selectedCuts,
    );

    const llmResponse = await this.llm.chat([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ]);

    return this.parseOTIOResponse(llmResponse);
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
      const isBRoll =
        !hasFaceInRange &&
        Math.random() < (profile.associativeCutProbability ?? profile.bRollProbability);

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
