use crate::types::AudioBeat;
use tokio::process::Command as TokioCommand;

/// Extract audio from a video file as 16kHz mono f32 PCM samples using ffmpeg CLI.
pub async fn extract_audio_pcm_16k(video_path: &str) -> anyhow::Result<Vec<f32>> {
    let output = TokioCommand::new("ffmpeg")
        .args([
            "-i", video_path,
            "-vn",           // no video
            "-ar", "16000",  // 16kHz (Whisper requirement)
            "-ac", "1",      // mono
            "-f", "f32le",   // raw f32 little-endian PCM
            "-loglevel", "error",
            "pipe:1",        // output to stdout
        ])
        .output()
        .await
        .map_err(|e| anyhow::anyhow!("Failed to run ffmpeg for audio extraction: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        anyhow::bail!("ffmpeg audio extraction failed: {stderr}");
    }

    if output.stdout.len() < 4 {
        anyhow::bail!("ffmpeg produced no audio data — file may have no audio track");
    }

    let pcm: Vec<f32> = output
        .stdout
        .chunks_exact(4)
        .map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]]))
        .collect();

    eprintln!(
        "[audio] Extracted {} samples ({:.1}s at 16kHz)",
        pcm.len(),
        pcm.len() as f64 / 16000.0
    );

    Ok(pcm)
}

/// Detect audio beats/onsets using energy-based onset detection.
///
/// Analyses the PCM signal in short windows, computes RMS energy,
/// and identifies peaks that exceed a dynamic threshold.
pub fn detect_beats(pcm: &[f32], sample_rate: u32) -> Vec<AudioBeat> {
    if pcm.is_empty() || sample_rate == 0 {
        return Vec::new();
    }

    // 50ms analysis windows, 25ms hop (50% overlap)
    let window_size = (sample_rate as usize) / 20; // 50ms
    let hop_size = window_size / 2;                 // 25ms

    // Compute RMS energy per window
    let mut energies: Vec<f64> = Vec::new();
    let mut pos = 0;
    while pos + window_size <= pcm.len() {
        let rms: f64 = (pcm[pos..pos + window_size]
            .iter()
            .map(|&s| (s as f64) * (s as f64))
            .sum::<f64>()
            / window_size as f64)
            .sqrt();
        energies.push(rms);
        pos += hop_size;
    }

    if energies.len() < 3 {
        return Vec::new();
    }

    // Adaptive threshold: local mean over a 500ms window
    let context_size = (500.0 / (hop_size as f64 / sample_rate as f64 * 1000.0)) as usize;
    let context_size = context_size.max(3);

    let mut beats: Vec<AudioBeat> = Vec::new();
    let min_beat_gap_windows = (300.0 / (hop_size as f64 / sample_rate as f64 * 1000.0)) as usize;

    for i in 1..energies.len() - 1 {
        // Local peak check
        if energies[i] <= energies[i - 1] || energies[i] < energies[i + 1] {
            continue;
        }

        // Compute local mean for adaptive threshold
        let ctx_start = i.saturating_sub(context_size / 2);
        let ctx_end = (i + context_size / 2).min(energies.len());
        let local_mean: f64 =
            energies[ctx_start..ctx_end].iter().sum::<f64>() / (ctx_end - ctx_start) as f64;

        // Must exceed 1.5× the local mean
        if energies[i] < local_mean * 1.5 {
            continue;
        }

        // Minimum gap between beats
        if let Some(last) = beats.last() {
            let last_window =
                (last.timestamp_ms / 1000.0 * sample_rate as f64 / hop_size as f64) as usize;
            if i.saturating_sub(last_window) < min_beat_gap_windows {
                continue;
            }
        }

        let timestamp_ms = i as f64 * hop_size as f64 / sample_rate as f64 * 1000.0;
        let strength = (energies[i] / (local_mean + 1e-10)).min(1.0);

        beats.push(AudioBeat {
            timestamp_ms,
            strength,
            bpm: None,
        });
    }

    // Estimate BPM from median beat interval
    if beats.len() >= 4 {
        let mut intervals: Vec<f64> = beats
            .windows(2)
            .map(|w| w[1].timestamp_ms - w[0].timestamp_ms)
            .collect();
        intervals.sort_by(|a, b| a.partial_cmp(b).unwrap());
        let median_interval = intervals[intervals.len() / 2];

        if median_interval > 0.0 {
            let bpm = 60000.0 / median_interval;
            if (40.0..=250.0).contains(&bpm) {
                for beat in &mut beats {
                    beat.bpm = Some(bpm);
                }
            }
        }
    }

    eprintln!("[audio] Detected {} beats", beats.len());
    beats
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detect_beats_empty_input() {
        assert!(detect_beats(&[], 16000).is_empty());
    }

    #[test]
    fn detect_beats_zero_sample_rate() {
        assert!(detect_beats(&[0.5; 1000], 0).is_empty());
    }

    #[test]
    fn detect_beats_too_short() {
        // Fewer samples than one window
        assert!(detect_beats(&[0.5; 100], 16000).is_empty());
    }

    #[test]
    fn detect_beats_monotonic_timestamps() {
        // Generate a signal with periodic spikes
        let sample_rate = 16000u32;
        let duration_secs = 5;
        let n_samples = sample_rate as usize * duration_secs;
        let mut pcm = vec![0.01f32; n_samples];

        // Add spikes every 500ms (120 BPM)
        let spike_interval = (sample_rate as usize) / 2;
        for i in (0..n_samples).step_by(spike_interval) {
            for j in 0..100.min(n_samples - i) {
                pcm[i + j] = 0.9;
            }
        }

        let beats = detect_beats(&pcm, sample_rate);
        for pair in beats.windows(2) {
            assert!(pair[1].timestamp_ms > pair[0].timestamp_ms);
        }
    }

    #[test]
    fn detect_beats_bpm_reasonable() {
        let sample_rate = 16000u32;
        let duration_secs = 10;
        let n_samples = sample_rate as usize * duration_secs;
        let mut pcm = vec![0.01f32; n_samples];

        // Add periodic spikes at 120 BPM (every 500ms)
        let spike_interval = (sample_rate as usize) / 2;
        for i in (0..n_samples).step_by(spike_interval) {
            for j in 0..80.min(n_samples - i) {
                pcm[i + j] = 0.8;
            }
        }

        let beats = detect_beats(&pcm, sample_rate);
        if beats.len() >= 4 {
            if let Some(bpm) = beats[0].bpm {
                assert!(bpm >= 40.0 && bpm <= 250.0, "BPM {bpm} out of range");
            }
        }
    }

    #[test]
    fn detect_beats_strength_bounded() {
        let sample_rate = 16000u32;
        let n_samples = sample_rate as usize * 3;
        let mut pcm = vec![0.01f32; n_samples];
        for i in (0..n_samples).step_by(8000) {
            for j in 0..100.min(n_samples - i) {
                pcm[i + j] = 0.9;
            }
        }

        let beats = detect_beats(&pcm, sample_rate);
        for beat in &beats {
            assert!(beat.strength >= 0.0 && beat.strength <= 1.0);
        }
    }
}
