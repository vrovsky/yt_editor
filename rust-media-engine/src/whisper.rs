use crate::types::{TranscriptSegment, TranscriptWord};
use candle_core::{Device, IndexOp, Tensor};
use candle_nn::VarBuilder;
use candle_transformers::models::whisper::{self as m, audio, Config};
use hf_hub::api::sync::Api;
use tokenizers::Tokenizer;

/// Default Whisper model on Hugging Face Hub.
const DEFAULT_MODEL_ID: &str = "openai/whisper-small";

/// Whisper constants
const SAMPLE_RATE: usize = 16000;
const CHUNK_LENGTH_S: usize = 30;
const N_SAMPLES: usize = CHUNK_LENGTH_S * SAMPLE_RATE; // 480_000

// ─── Mel Filterbank Computation ────────────────────────────────────────

/// Compute mel filterbank (Slaney-normalised, HTK mel scale).
/// Matches librosa.filters.mel(sr=16000, n_fft=400, n_mels=80).
fn compute_mel_filters(sr: f64, n_fft: usize, n_mels: usize) -> Vec<f32> {
    let n_freqs = n_fft / 2 + 1;

    let hz_to_mel = |f: f64| -> f64 { 2595.0 * (1.0 + f / 700.0).log10() };
    let mel_to_hz = |m: f64| -> f64 { 700.0 * (10.0_f64.powf(m / 2595.0) - 1.0) };

    let mel_min = hz_to_mel(0.0);
    let mel_max = hz_to_mel(sr / 2.0);

    let mel_points: Vec<f64> = (0..=n_mels + 1)
        .map(|i| mel_min + (mel_max - mel_min) * i as f64 / (n_mels + 1) as f64)
        .collect();

    let freq_points: Vec<f64> = mel_points.iter().map(|&m| mel_to_hz(m)).collect();
    let fft_freqs: Vec<f64> = (0..n_freqs)
        .map(|i| sr * i as f64 / n_fft as f64)
        .collect();

    let mut weights = vec![0.0f32; n_mels * n_freqs];

    for i in 0..n_mels {
        let lower = freq_points[i];
        let center = freq_points[i + 1];
        let upper = freq_points[i + 2];

        // Slaney normalization
        let enorm = 2.0 / (upper - lower);

        for (j, &f) in fft_freqs.iter().enumerate() {
            let w = if f >= lower && f <= center {
                (f - lower) / (center - lower)
            } else if f > center && f <= upper {
                (upper - f) / (upper - center)
            } else {
                0.0
            };
            weights[i * n_freqs + j] = (w * enorm) as f32;
        }
    }

    weights
}

// ─── Token Helpers ─────────────────────────────────────────────────────

fn token_id(tokenizer: &Tokenizer, token: &str) -> anyhow::Result<u32> {
    match tokenizer.token_to_id(token) {
        Some(id) => Ok(id),
        None => anyhow::bail!("Token '{token}' not found in tokenizer vocabulary"),
    }
}

// ─── Model Wrapper ─────────────────────────────────────────────────────

struct WhisperModel {
    model: m::model::Whisper,
    config: Config,
    tokenizer: Tokenizer,
    mel_filters: Vec<f32>,
    device: Device,
}

impl WhisperModel {
    /// Download and load the Whisper model from Hugging Face Hub.
    fn load(device: &Device, model_id: Option<&str>) -> anyhow::Result<Self> {
        let model_id = model_id.unwrap_or(DEFAULT_MODEL_ID);
        eprintln!("[whisper] Loading model '{model_id}' ...");

        let api = Api::new().map_err(|e| anyhow::anyhow!("Failed to create HF Hub API: {e}"))?;
        let repo = api.model(model_id.to_string());

        eprintln!("[whisper] Downloading/caching model files ...");
        let config_path = repo
            .get("config.json")
            .map_err(|e| anyhow::anyhow!("Failed to get config.json: {e}"))?;
        let tokenizer_path = repo
            .get("tokenizer.json")
            .map_err(|e| anyhow::anyhow!("Failed to get tokenizer.json: {e}"))?;
        let weights_path = repo
            .get("model.safetensors")
            .map_err(|e| anyhow::anyhow!("Failed to get model.safetensors: {e}"))?;

        eprintln!("[whisper] Parsing config ...");
        let config: Config = serde_json::from_str(
            &std::fs::read_to_string(&config_path)
                .map_err(|e| anyhow::anyhow!("Failed to read config: {e}"))?,
        )
        .map_err(|e| anyhow::anyhow!("Failed to parse config: {e}"))?;

        eprintln!("[whisper] Loading tokenizer ...");
        let tokenizer = Tokenizer::from_file(&tokenizer_path)
            .map_err(|e| anyhow::anyhow!("Failed to load tokenizer: {e}"))?;

        eprintln!("[whisper] Loading model weights ({}) ...", device_name(device));
        let vb = unsafe {
            VarBuilder::from_mmaped_safetensors(&[weights_path], candle_core::DType::F32, device)
                .map_err(|e| anyhow::anyhow!("Failed to load weights: {e}"))?
        };

        let model = m::model::Whisper::load(&vb, config.clone())
            .map_err(|e| anyhow::anyhow!("Failed to build Whisper model: {e}"))?;

        let n_mels = config.num_mel_bins;
        let mel_filters = compute_mel_filters(SAMPLE_RATE as f64, 400, n_mels);

        eprintln!("[whisper] Model loaded successfully ({n_mels} mel bins)");

        Ok(Self {
            model,
            config,
            tokenizer,
            mel_filters,
            device: device.clone(),
        })
    }

    /// Transcribe PCM audio (16kHz mono f32) into timestamped segments.
    fn transcribe(&mut self, pcm_16k: &[f32]) -> anyhow::Result<Vec<TranscriptSegment>> {
        let sot_token = token_id(&self.tokenizer, m::SOT_TOKEN)?;
        let eot_token = token_id(&self.tokenizer, m::EOT_TOKEN)?;
        let transcribe_token = token_id(&self.tokenizer, m::TRANSCRIBE_TOKEN)?;
        let no_timestamps_token = token_id(&self.tokenizer, m::NO_TIMESTAMPS_TOKEN)?;

        // Language token: English
        let language_token = self.tokenizer.token_to_id("<|en|>");

        let mut all_segments: Vec<TranscriptSegment> = Vec::new();
        let mut segment_id = 0u32;

        // Process in 30-second chunks
        let total_chunks = (pcm_16k.len() + N_SAMPLES - 1) / N_SAMPLES;

        for chunk_idx in 0..total_chunks {
            let chunk_start_sample = chunk_idx * N_SAMPLES;
            let chunk_end_sample = (chunk_start_sample + N_SAMPLES).min(pcm_16k.len());
            let chunk = &pcm_16k[chunk_start_sample..chunk_end_sample];

            let chunk_offset_ms = chunk_start_sample as f64 / SAMPLE_RATE as f64 * 1000.0;

            eprintln!(
                "[whisper] Processing chunk {}/{} (offset {:.1}s) ...",
                chunk_idx + 1,
                total_chunks,
                chunk_offset_ms / 1000.0
            );

            // Pad chunk to exactly N_SAMPLES (Whisper expects fixed 30s input)
            let padded_chunk: Vec<f32> = if chunk.len() < N_SAMPLES {
                let mut padded = chunk.to_vec();
                padded.resize(N_SAMPLES, 0.0);
                padded
            } else {
                chunk[..N_SAMPLES].to_vec()
            };

            // Compute mel spectrogram — pcm_to_mel returns Vec<f32>
            // NOTE: candle's pcm_to_mel adds extra padding internally,
            // producing more frames than N_FRAMES (3000). We must truncate
            // to exactly N_FRAMES so the encoder's positional embeddings fit.
            let mel_data = audio::pcm_to_mel(&self.config, &padded_chunk, &self.mel_filters);
            let n_mels = self.config.num_mel_bins;
            let n_frames = N_SAMPLES / 160; // N_FRAMES = 3000
            let full_row_len = mel_data.len() / n_mels;
            let mel_data_truncated: Vec<f32> = (0..n_mels)
                .flat_map(|mel_idx| {
                    let full_row_start = mel_idx * full_row_len;
                    let row_end = (full_row_start + n_frames).min(full_row_start + full_row_len);
                    let frames_available = row_end - full_row_start;
                    let mut row = mel_data[full_row_start..full_row_start + frames_available].to_vec();
                    // Pad with zeros if fewer frames than expected
                    row.resize(n_frames, 0.0);
                    row
                })
                .collect();
            let mel = Tensor::from_vec(mel_data_truncated, (1, n_mels, n_frames), &self.device)
                .map_err(|e| anyhow::anyhow!("Mel tensor creation failed: {e}"))?;

            // Run encoder
            let audio_features = self
                .model
                .encoder
                .forward(&mel, true)
                .map_err(|e| anyhow::anyhow!("Encoder forward failed: {e}"))?;

            // Decode with timestamps
            let chunk_segments = self.decode_chunk(
                &audio_features,
                sot_token,
                eot_token,
                transcribe_token,
                no_timestamps_token,
                language_token,
                chunk_offset_ms,
                &mut segment_id,
            )?;

            all_segments.extend(chunk_segments);
        }

        eprintln!(
            "[whisper] Transcription complete: {} segments",
            all_segments.len()
        );

        Ok(all_segments)
    }

    /// Decode a single 30-second chunk using greedy search with timestamps.
    #[allow(clippy::too_many_arguments)]
    fn decode_chunk(
        &mut self,
        audio_features: &Tensor,
        sot_token: u32,
        eot_token: u32,
        transcribe_token: u32,
        no_timestamps_token: u32,
        language_token: Option<u32>,
        chunk_offset_ms: f64,
        segment_id: &mut u32,
    ) -> anyhow::Result<Vec<TranscriptSegment>> {
        let timestamp_begin = no_timestamps_token + 1;
        let max_tokens = self.config.max_target_positions / 2;

        // Initial tokens: SOT + language + transcribe (timestamps enabled)
        let mut tokens: Vec<u32> = vec![sot_token];
        if let Some(lang) = language_token {
            tokens.push(lang);
        }
        tokens.push(transcribe_token);
        // Do NOT push no_timestamps_token — we want timestamps

        // Greedy decoding loop
        for i in 0..max_tokens {
            let tokens_t = Tensor::new(tokens.as_slice(), &self.device)
                .map_err(|e| anyhow::anyhow!("Token tensor failed: {e}"))?;
            let tokens_t = tokens_t
                .unsqueeze(0)
                .map_err(|e| anyhow::anyhow!("Batch unsqueeze failed: {e}"))?;

            let ys = self
                .model
                .decoder
                .forward(&tokens_t, audio_features, i == 0)
                .map_err(|e| anyhow::anyhow!("Decoder forward failed: {e}"))?;

            let (_, seq_len, _) = ys
                .dims3()
                .map_err(|e| anyhow::anyhow!("Dims failed: {e}"))?;
            let logits = self
                .model
                .decoder
                .final_linear(&ys.i((..1, seq_len - 1..))?)
                .map_err(|e| anyhow::anyhow!("Final linear failed: {e}"))?;
            let logits = logits
                .i(0)
                .map_err(|e| anyhow::anyhow!("Index 0 failed: {e}"))?
                .i(0)
                .map_err(|e| anyhow::anyhow!("Index 0.0 failed: {e}"))?;

            // Greedy: argmax
            let logits_v: Vec<f32> = logits
                .to_vec1()
                .map_err(|e| anyhow::anyhow!("To vec failed: {e}"))?;
            let next_token = logits_v
                .iter()
                .enumerate()
                .max_by(|(_, a), (_, b)| a.total_cmp(b))
                .map(|(i, _)| i as u32)
                .unwrap_or(eot_token);

            tokens.push(next_token);

            if next_token == eot_token || tokens.len() > max_tokens {
                break;
            }
        }

        // Parse tokens into segments with timestamps
        let segments =
            self.parse_tokens_to_segments(&tokens, timestamp_begin, chunk_offset_ms, segment_id)?;

        Ok(segments)
    }

    /// Parse decoded tokens into transcript segments using timestamp tokens.
    fn parse_tokens_to_segments(
        &self,
        tokens: &[u32],
        timestamp_begin: u32,
        chunk_offset_ms: f64,
        segment_id: &mut u32,
    ) -> anyhow::Result<Vec<TranscriptSegment>> {
        let mut segments: Vec<TranscriptSegment> = Vec::new();
        let eot = self
            .tokenizer
            .token_to_id(m::EOT_TOKEN)
            .unwrap_or(u32::MAX);

        let mut current_start_ms: Option<f64> = None;
        let mut current_text_tokens: Vec<u32> = Vec::new();

        for &tok in tokens {
            if tok == eot {
                break;
            }

            if tok >= timestamp_begin {
                // Timestamp token: value encodes time in 20ms increments
                let time_ms = (tok - timestamp_begin) as f64 * 20.0 + chunk_offset_ms;

                if current_start_ms.is_none() {
                    // Start of a new segment
                    current_start_ms = Some(time_ms);
                } else {
                    // End of current segment
                    let start_ms = current_start_ms.take().unwrap();
                    let end_ms = time_ms;

                    if !current_text_tokens.is_empty() {
                        let text = self
                            .tokenizer
                            .decode(&current_text_tokens, true)
                            .unwrap_or_default()
                            .trim()
                            .to_string();

                        if !text.is_empty() {
                            let words =
                                interpolate_words(&text, start_ms, end_ms);
                            segments.push(TranscriptSegment {
                                id: *segment_id,
                                start_ms,
                                end_ms,
                                text,
                                words,
                            });
                            *segment_id += 1;
                        }
                    }
                    current_text_tokens.clear();
                }
            } else {
                // Regular text token
                current_text_tokens.push(tok);
            }
        }

        // Handle any remaining tokens without end timestamp
        if !current_text_tokens.is_empty() {
            let start_ms = current_start_ms.unwrap_or(chunk_offset_ms);
            let text = self
                .tokenizer
                .decode(&current_text_tokens, true)
                .unwrap_or_default()
                .trim()
                .to_string();

            let word_count = text.split_whitespace().count();
            if !text.is_empty() && word_count > 0 {
                let end_ms = start_ms + word_count as f64 * 300.0;
                let words = interpolate_words(&text, start_ms, end_ms);
                segments.push(TranscriptSegment {
                    id: *segment_id,
                    start_ms,
                    end_ms,
                    text,
                    words,
                });
                *segment_id += 1;
            }
        }

        Ok(segments)
    }
}

/// Interpolate word-level timestamps by evenly distributing within a segment.
fn interpolate_words(text: &str, start_ms: f64, end_ms: f64) -> Vec<TranscriptWord> {
    let word_strs: Vec<&str> = text.split_whitespace().collect();
    if word_strs.is_empty() {
        return Vec::new();
    }

    let duration = end_ms - start_ms;
    let word_duration = duration / word_strs.len() as f64;

    word_strs
        .iter()
        .enumerate()
        .map(|(i, &w)| {
            let is_last = i == word_strs.len() - 1;
            TranscriptWord {
                text: w.to_string(),
                start_ms: start_ms + i as f64 * word_duration,
                end_ms: if is_last { end_ms } else { start_ms + (i + 1) as f64 * word_duration },
                confidence: 0.85, // greedy decoding doesn't give per-word confidence
            }
        })
        .collect()
}

fn device_name(device: &Device) -> &'static str {
    match device {
        Device::Cpu => "CPU",
        Device::Cuda(_) => "CUDA",
        Device::Metal(_) => "Metal",
    }
}

// ─── Public API ────────────────────────────────────────────────────────

/// Transcribe PCM audio using Whisper.
///
/// - `pcm_16k`: raw audio samples at 16kHz, mono, f32
/// - `device`: compute device (CPU/CUDA/Metal)
///
/// Returns timestamped transcript segments with word-level annotations.
pub fn transcribe(pcm_16k: &[f32], device: &Device) -> anyhow::Result<Vec<TranscriptSegment>> {
    if pcm_16k.is_empty() {
        anyhow::bail!("Empty audio — cannot transcribe");
    }

    let mut model = WhisperModel::load(device, None)?;
    model.transcribe(pcm_16k)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn interpolate_words_correct_count() {
        let words = interpolate_words("hello world foo", 0.0, 3000.0);
        assert_eq!(words.len(), 3);
    }

    #[test]
    fn interpolate_words_timing_bounds() {
        let words = interpolate_words("hello world foo", 1000.0, 4000.0);
        assert!((words[0].start_ms - 1000.0).abs() < 0.01);
        assert!((words[2].end_ms - 4000.0).abs() < 0.01);
    }

    #[test]
    fn interpolate_words_monotonic() {
        let words = interpolate_words("a b c d e", 0.0, 5000.0);
        for pair in words.windows(2) {
            assert!(pair[1].start_ms >= pair[0].end_ms - 0.01);
        }
    }

    #[test]
    fn interpolate_words_last_word_snaps_to_end() {
        let words = interpolate_words("hello world test", 0.0, 1000.0);
        // Last word end should be exactly end_ms, not accumulated float
        assert!((words.last().unwrap().end_ms - 1000.0).abs() < 0.001);
    }

    #[test]
    fn interpolate_words_single_word() {
        let words = interpolate_words("hello", 500.0, 1500.0);
        assert_eq!(words.len(), 1);
        assert!((words[0].start_ms - 500.0).abs() < 0.01);
        assert!((words[0].end_ms - 1500.0).abs() < 0.01);
    }

    #[test]
    fn interpolate_words_empty_string() {
        let words = interpolate_words("", 0.0, 1000.0);
        assert!(words.is_empty());
    }

    #[test]
    fn interpolate_words_whitespace_only() {
        let words = interpolate_words("   ", 0.0, 1000.0);
        assert!(words.is_empty());
    }

    #[test]
    fn interpolate_words_confidence_set() {
        let words = interpolate_words("hello world", 0.0, 2000.0);
        for w in &words {
            assert!((w.confidence - 0.85).abs() < 0.01);
        }
    }
}
