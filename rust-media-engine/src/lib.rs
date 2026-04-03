#![deny(clippy::all)]

mod audio;
mod device;
mod saliency;
mod scene;
mod smart_export;
mod types;
mod whisper;

use napi::bindgen_prelude::*;
use napi_derive::napi;
use std::path::PathBuf;

pub use types::*;

// ─── Silent Pause Detection (pure logic, no external deps) ─────────────

const SILENCE_THRESHOLD_MS: f64 = 400.0;

fn detect_silent_pauses(segments: &[TranscriptSegment]) -> Vec<SilentPause> {
    let mut pauses: Vec<SilentPause> = Vec::new();

    // Intra-segment gaps (between words)
    for segment in segments {
        for pair in segment.words.windows(2) {
            let gap = pair[1].start_ms - pair[0].end_ms;
            if gap >= SILENCE_THRESHOLD_MS {
                pauses.push(SilentPause {
                    start_ms: pair[0].end_ms,
                    end_ms: pair[1].start_ms,
                    duration_ms: gap,
                });
            }
        }
    }

    // Inter-segment gaps (between segments)
    for pair in segments.windows(2) {
        let gap = pair[1].start_ms - pair[0].end_ms;
        if gap >= SILENCE_THRESHOLD_MS {
            pauses.push(SilentPause {
                start_ms: pair[0].end_ms,
                end_ms: pair[1].start_ms,
                duration_ms: gap,
            });
        }
    }

    pauses.sort_by(|a, b| a.start_ms.partial_cmp(&b.start_ms).unwrap());
    pauses.dedup_by(|a, b| {
        if a.start_ms <= b.end_ms {
            b.end_ms = a.end_ms.max(b.end_ms);
            b.duration_ms = b.end_ms - b.start_ms;
            true
        } else {
            false
        }
    });

    pauses
}

// ─── Temp File Helper ──────────────────────────────────────────────────

fn write_temp_video(data: &[u8]) -> Result<PathBuf> {
    let temp_dir = std::env::temp_dir();
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis();
    let temp_path = temp_dir.join(format!("yt_editor_input_{ts}.mp4"));
    std::fs::write(&temp_path, data).map_err(|e| {
        Error::new(
            Status::GenericFailure,
            format!("Failed to write temp video: {e}"),
        )
    })?;
    Ok(temp_path)
}

// ─── NAPI Exports ──────────────────────────────────────────────────────

/// Full media analysis pipeline: transcription, scene detection,
/// saliency analysis, beat detection, and silent pause detection.
#[napi]
pub async fn analyze_media(
    file_buffer: Buffer,
    file_name: String,
    fps: f64,
    duration_ms: f64,
    width: u32,
    height: u32,
) -> Result<MetadataManifest> {
    let data: &[u8] = file_buffer.as_ref();
    if data.is_empty() {
        return Err(Error::new(Status::InvalidArg, "File buffer is empty"));
    }

    eprintln!(
        "[analyze_media] Starting analysis of '{}' ({:.1} MB, {:.1}s)",
        file_name,
        data.len() as f64 / 1024.0 / 1024.0,
        duration_ms / 1000.0
    );

    // Write buffer to temp file for ffmpeg-based operations
    let temp_path = write_temp_video(data)?;
    let temp_path_str = temp_path.to_string_lossy().to_string();

    // Select best compute device for ML inference
    let compute_device = device::best_device().map_err(|e| {
        Error::new(
            Status::GenericFailure,
            format!("Device selection failed: {e}"),
        )
    })?;

    // ── Step 1: Extract audio ──
    eprintln!("[analyze_media] Step 1/5: Extracting audio ...");
    let pcm_16k = audio::extract_audio_pcm_16k(&temp_path_str).await.map_err(|e| {
        Error::new(
            Status::GenericFailure,
            format!("Audio extraction failed: {e}"),
        )
    })?;

    // ── Step 2: Whisper transcription ──
    eprintln!("[analyze_media] Step 2/5: Running Whisper transcription ...");
    let pcm_clone = pcm_16k.clone();
    let device_clone = compute_device.clone();
    let transcript = tokio::task::spawn_blocking(move || {
        whisper::transcribe(&pcm_clone, &device_clone)
    })
    .await
    .map_err(|e| {
        Error::new(
            Status::GenericFailure,
            format!("Whisper task panicked: {e}"),
        )
    })?
    .map_err(|e| {
        Error::new(
            Status::GenericFailure,
            format!("Whisper transcription failed: {e}"),
        )
    })?;

    // ── Step 3: Silent pause detection ──
    eprintln!("[analyze_media] Step 3/5: Detecting silent pauses ...");
    let silent_pauses = detect_silent_pauses(&transcript);

    // ── Step 4: Scene change detection ──
    eprintln!("[analyze_media] Step 4/5: Detecting scene changes ...");
    let scene_changes = scene::detect_scenes(&temp_path_str, fps, None)
        .await
        .map_err(|e| {
            Error::new(
                Status::GenericFailure,
                format!("Scene detection failed: {e}"),
            )
        })?;

    // ── Step 5: Saliency analysis ──
    eprintln!("[analyze_media] Step 5/5: Analysing saliency ...");
    let saliency_map = saliency::analyze_saliency(&temp_path_str, fps, duration_ms)
        .await
        .map_err(|e| {
            Error::new(
                Status::GenericFailure,
                format!("Saliency analysis failed: {e}"),
            )
        })?;

    // ── Step 6: Beat detection ──
    eprintln!("[analyze_media] Detecting audio beats ...");
    let audio_beats = audio::detect_beats(&pcm_16k, 16000);

    // Clean up temp file
    let _ = std::fs::remove_file(&temp_path);

    eprintln!(
        "[analyze_media] Analysis complete: {} transcript segments, {} scenes, {} saliency frames, {} pauses, {} beats",
        transcript.len(),
        scene_changes.len(),
        saliency_map.len(),
        silent_pauses.len(),
        audio_beats.len(),
    );

    Ok(MetadataManifest {
        source_file: file_name,
        duration_ms,
        fps,
        width,
        height,
        transcript,
        scene_changes,
        silent_pauses,
        saliency_map,
        audio_beats,
    })
}

/// Alias for backwards compatibility.
#[napi]
pub async fn extract_metadata(
    file_buffer: Buffer,
    file_name: String,
    fps: f64,
    duration_ms: f64,
    width: u32,
    height: u32,
) -> Result<MetadataManifest> {
    analyze_media(file_buffer, file_name, fps, duration_ms, width, height).await
}

/// Smart export: concatenate timeline segments, re-muxing where possible.
#[napi]
pub async fn smart_export(
    segments: Vec<ExportSegment>,
    output_file: String,
) -> Result<ExportResult> {
    smart_export::smart_export(segments, output_file).await
}

/// Legacy shot-change detection (simple threshold check).
#[napi]
pub fn detect_shot_change(frame_buffer: Buffer, threshold: f64) -> Result<bool> {
    let data: &[u8] = frame_buffer.as_ref();
    if data.is_empty() {
        return Err(Error::new(Status::InvalidArg, "Frame buffer is empty"));
    }
    let sum: u64 = data.iter().map(|&b| b as u64).sum();
    let avg = sum as f64 / data.len() as f64;
    Ok(avg > threshold)
}

// ─── Tests ──────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn make_word(text: &str, start_ms: f64, end_ms: f64) -> TranscriptWord {
        TranscriptWord {
            text: text.to_string(),
            start_ms,
            end_ms,
            confidence: 0.9,
        }
    }

    fn make_segment(id: u32, start_ms: f64, end_ms: f64, words: Vec<TranscriptWord>) -> TranscriptSegment {
        TranscriptSegment {
            id,
            start_ms,
            end_ms,
            text: words.iter().map(|w| w.text.as_str()).collect::<Vec<_>>().join(" "),
            words,
        }
    }

    #[test]
    fn silent_pauses_inter_segment_gap() {
        let segments = vec![
            make_segment(0, 0.0, 2000.0, vec![make_word("hello", 0.0, 2000.0)]),
            make_segment(1, 3000.0, 5000.0, vec![make_word("world", 3000.0, 5000.0)]),
        ];
        let pauses = detect_silent_pauses(&segments);
        assert_eq!(pauses.len(), 1);
        assert!((pauses[0].start_ms - 2000.0).abs() < 0.01);
        assert!((pauses[0].end_ms - 3000.0).abs() < 0.01);
        assert!((pauses[0].duration_ms - 1000.0).abs() < 0.01);
    }

    #[test]
    fn silent_pauses_sub_threshold_ignored() {
        let segments = vec![
            make_segment(0, 0.0, 2000.0, vec![make_word("hello", 0.0, 2000.0)]),
            make_segment(1, 2200.0, 4000.0, vec![make_word("world", 2200.0, 4000.0)]),
        ];
        let pauses = detect_silent_pauses(&segments);
        // 200ms gap < 400ms threshold
        assert!(pauses.is_empty());
    }

    #[test]
    fn silent_pauses_intra_segment_word_gap() {
        let segments = vec![
            make_segment(0, 0.0, 5000.0, vec![
                make_word("hello", 0.0, 1000.0),
                make_word("world", 2000.0, 3000.0), // 1000ms gap between words
            ]),
        ];
        let pauses = detect_silent_pauses(&segments);
        assert_eq!(pauses.len(), 1);
        assert!((pauses[0].start_ms - 1000.0).abs() < 0.01);
        assert!((pauses[0].end_ms - 2000.0).abs() < 0.01);
    }

    #[test]
    fn silent_pauses_empty_segments() {
        let pauses = detect_silent_pauses(&[]);
        assert!(pauses.is_empty());
    }

    #[test]
    fn silent_pauses_single_segment_no_word_gap() {
        let segments = vec![
            make_segment(0, 0.0, 3000.0, vec![
                make_word("hello", 0.0, 1500.0),
                make_word("world", 1500.0, 3000.0),
            ]),
        ];
        let pauses = detect_silent_pauses(&segments);
        assert!(pauses.is_empty());
    }

    #[test]
    fn silent_pauses_overlapping_merged() {
        // Two segments with a big gap, plus words that also create a gap in the same region
        let segments = vec![
            make_segment(0, 0.0, 1000.0, vec![make_word("a", 0.0, 1000.0)]),
            make_segment(1, 2000.0, 4000.0, vec![
                make_word("b", 2000.0, 2500.0),
                make_word("c", 3000.0, 4000.0), // intra gap 500ms at 2500-3000
            ]),
        ];
        let pauses = detect_silent_pauses(&segments);
        // Inter-segment gap: 1000-2000 (1000ms) and intra-word gap: 2500-3000 (500ms)
        // These don't overlap, so should be 2 pauses
        assert_eq!(pauses.len(), 2);
    }

    #[test]
    fn silent_pauses_sorted_by_start() {
        let segments = vec![
            make_segment(0, 0.0, 1000.0, vec![make_word("a", 0.0, 1000.0)]),
            make_segment(1, 5000.0, 6000.0, vec![make_word("b", 5000.0, 6000.0)]),
            make_segment(2, 10000.0, 11000.0, vec![make_word("c", 10000.0, 11000.0)]),
        ];
        let pauses = detect_silent_pauses(&segments);
        for pair in pauses.windows(2) {
            assert!(pair[0].start_ms <= pair[1].start_ms);
        }
    }
}
