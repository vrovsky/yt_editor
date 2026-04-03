use crate::types::SaliencyFrame;
use hf_hub::api::sync::Api;
use ort::session::Session;
use ort::value::TensorRef;
use tokio::process::Command as TokioCommand;

/// HuggingFace model repo for MobileNet-v3-Small ONNX.
const MOBILENET_REPO: &str = "onnx-community/mobilenetv3_small_100.lamb_in1k";
const MOBILENET_FILE: &str = "onnx/model.onnx";

/// ImageNet normalisation constants.
const IMAGENET_MEAN: [f32; 3] = [0.485, 0.456, 0.406];
const IMAGENET_STD: [f32; 3] = [0.229, 0.224, 0.225];

/// Analysis frame dimensions (MobileNet expects 224×224).
const MODEL_SIZE: usize = 224;
/// Frame extraction resolution (small for fast ffmpeg extraction, resized before CNN).
const EXTRACT_W: usize = 224;
const EXTRACT_H: usize = 224;

// ─── Model Loading ─────────────────────────────────────────────────────

/// Download MobileNet-v3-Small ONNX model from HuggingFace and create an
/// ONNX Runtime inference session.
fn load_mobilenet_session() -> anyhow::Result<Session> {
    eprintln!("[saliency] Downloading/caching MobileNet-v3-Small ONNX model ...");

    let api = Api::new().map_err(|e| anyhow::anyhow!("HF Hub API error: {e}"))?;
    let repo = api.model(MOBILENET_REPO.to_string());
    let model_path = repo
        .get(MOBILENET_FILE)
        .map_err(|e| anyhow::anyhow!("Failed to download MobileNet model: {e}"))?;

    eprintln!("[saliency] Loading ONNX Runtime session ...");

    let session = Session::builder()
        .map_err(|e| anyhow::anyhow!("ONNX session builder error: {e}"))?
        .with_optimization_level(ort::session::builder::GraphOptimizationLevel::Level3)
        .map_err(|e| anyhow::anyhow!("ONNX optimization error: {e}"))?
        .commit_from_file(&model_path)
        .map_err(|e| anyhow::anyhow!("ONNX model load error: {e}"))?;

    eprintln!("[saliency] MobileNet session ready");
    Ok(session)
}


/// Compute saliency score from MobileNet class probabilities.
///
/// Uses the maximum class probability as a proxy for visual distinctiveness.
/// A high max-prob means the model confidently recognises something → salient.
/// Low max-prob means visual noise / bland → less salient.
fn compute_saliency_from_logits(logits: &[f32]) -> f64 {
    if logits.is_empty() {
        return 0.5;
    }

    // Softmax
    let max_logit = logits.iter().cloned().fold(f32::NEG_INFINITY, f32::max);
    let exp_sum: f32 = logits.iter().map(|&x| (x - max_logit).exp()).sum();
    let probs: Vec<f32> = logits.iter().map(|&x| (x - max_logit).exp() / exp_sum).collect();

    // Saliency = max probability (higher = more recognisable = more salient)
    let max_prob = probs.iter().cloned().fold(0.0_f32, f32::max) as f64;

    // Also compute entropy — low entropy = focused/salient image
    let entropy: f64 = probs
        .iter()
        .filter(|&&p| p > 1e-10)
        .map(|&p| -(p as f64) * (p as f64).ln())
        .sum();
    let max_entropy = (logits.len() as f64).ln(); // uniform distribution
    let normalised_entropy = if max_entropy > 0.0 {
        entropy / max_entropy
    } else {
        1.0
    };

    // Combined saliency: high max_prob and low entropy → high saliency
    let saliency = 0.6 * max_prob + 0.4 * (1.0 - normalised_entropy);
    saliency.clamp(0.0, 1.0)
}

// ─── Heuristic Fallbacks ───────────────────────────────────────────────

/// Compute motion magnitude as normalised MAD between two luminance frames.
fn compute_motion(prev: &[f64], curr: &[f64]) -> f64 {
    if prev.len() != curr.len() || prev.is_empty() {
        return 0.0;
    }
    let mad: f64 = prev
        .iter()
        .zip(curr.iter())
        .map(|(a, b)| (a - b).abs())
        .sum::<f64>()
        / prev.len() as f64;
    (mad / 40.0).min(1.0)
}

/// Simple skin-tone detection in the upper half of the frame for face presence.
fn detect_skin_tone_upper(rgb: &[u8], width: usize, height: usize) -> bool {
    let upper_half_height = height / 2;
    let mut skin_pixels = 0u32;
    let total_pixels = (width * upper_half_height) as u32;

    for y in 0..upper_half_height {
        for x in 0..width {
            let idx = (y * width + x) * 3;
            if idx + 2 >= rgb.len() {
                break;
            }
            let r = rgb[idx] as f64;
            let g = rgb[idx + 1] as f64;
            let b = rgb[idx + 2] as f64;

            let cb = 128.0 - 0.169 * r - 0.331 * g + 0.500 * b;
            let cr = 128.0 + 0.500 * r - 0.419 * g - 0.081 * b;

            if (77.0..=127.0).contains(&cb) && (133.0..=173.0).contains(&cr) {
                skin_pixels += 1;
            }
        }
    }

    total_pixels > 0 && (skin_pixels as f64 / total_pixels as f64) > 0.05
}

/// Compute focus point as variance-weighted center of mass.
fn compute_focus_point(luma: &[f64], width: usize, height: usize) -> (f64, f64) {
    let block = 8;
    let mut wx = 0.0;
    let mut wy = 0.0;
    let mut tw = 0.0;

    for by in (0..height).step_by(block) {
        for bx in (0..width).step_by(block) {
            let mut sum = 0.0;
            let mut sum_sq = 0.0;
            let mut count = 0.0;

            for dy in 0..block.min(height - by) {
                for dx in 0..block.min(width - bx) {
                    let v = luma[(by + dy) * width + (bx + dx)];
                    sum += v;
                    sum_sq += v * v;
                    count += 1.0;
                }
            }

            if count > 1.0 {
                let mean = sum / count;
                let var = ((sum_sq / count) - (mean * mean)).max(0.0);
                let w = var.sqrt();
                wx += ((bx as f64 + block as f64 / 2.0) / width as f64) * w;
                wy += ((by as f64 + block as f64 / 2.0) / height as f64) * w;
                tw += w;
            }
        }
    }

    if tw > 0.0 {
        ((wx / tw).clamp(0.0, 1.0), (wy / tw).clamp(0.0, 1.0))
    } else {
        (0.5, 0.5)
    }
}

// ─── Public API ────────────────────────────────────────────────────────

/// Analyse video frames for saliency using MobileNet-v3-Small CNN +
/// heuristic motion/face/focus metrics.
///
/// Pipeline:
/// 1. Extract frames at 1fps via ffmpeg (224×224 RGB24)
/// 2. Run each frame through MobileNet CNN for saliency score
/// 3. Compute motion via frame differencing
/// 4. Detect faces via skin-tone heuristic
/// 5. Compute focus point via variance-weighted center of mass
pub async fn analyze_saliency(
    video_path: &str,
    fps: f64,
    duration_ms: f64,
) -> anyhow::Result<Vec<SaliencyFrame>> {
    let analysis_fps = 1.0_f64;

    // Extract raw RGB frames at 1fps, scaled to 224×224 for MobileNet
    let output = TokioCommand::new("ffmpeg")
        .args([
            "-i",
            video_path,
            "-vf",
            &format!("fps={analysis_fps},scale={EXTRACT_W}:{EXTRACT_H}"),
            "-pix_fmt",
            "rgb24",
            "-f",
            "rawvideo",
            "-loglevel",
            "error",
            "pipe:1",
        ])
        .output()
        .await
        .map_err(|e| anyhow::anyhow!("ffmpeg frame extraction failed: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        anyhow::bail!("ffmpeg frame extraction error: {stderr}");
    }

    let frame_size = EXTRACT_W * EXTRACT_H * 3;
    let raw = &output.stdout;

    if raw.len() < frame_size {
        anyhow::bail!("ffmpeg produced less than one frame");
    }

    let n_frames = raw.len() / frame_size;
    let mut frames: Vec<&[u8]> = Vec::with_capacity(n_frames);
    for i in 0..n_frames {
        frames.push(&raw[i * frame_size..(i + 1) * frame_size]);
    }

    eprintln!("[saliency] Extracted {n_frames} frames, loading CNN model ...");

    // Load MobileNet ONNX session (blocking — run in spawn_blocking from caller)
    let mut session = match load_mobilenet_session() {
        Ok(s) => Some(s),
        Err(e) => {
            eprintln!("[saliency] WARNING: CNN model failed to load, falling back to heuristics: {e}");
            None
        }
    };

    let mut results: Vec<SaliencyFrame> = Vec::with_capacity(n_frames);
    let mut prev_luma: Option<Vec<f64>> = None;

    for (i, frame) in frames.iter().enumerate() {
        let timestamp_ms = i as f64 / analysis_fps * 1000.0;
        let frame_number = (timestamp_ms / 1000.0 * fps).round() as u32;

        // Convert to luminance for motion + focus
        let luma: Vec<f64> = frame
            .chunks_exact(3)
            .map(|px| 0.299 * px[0] as f64 + 0.587 * px[1] as f64 + 0.114 * px[2] as f64)
            .collect();

        // ── CNN Saliency (falls back to heuristic if CNN fails) ──
        let saliency_score = if let Some(ref mut sess) = session {
            run_cnn_saliency(sess, frame, EXTRACT_W, EXTRACT_H)
                .unwrap_or_else(|| compute_spatial_contrast_heuristic(&luma, EXTRACT_W, EXTRACT_H))
        } else {
            compute_spatial_contrast_heuristic(&luma, EXTRACT_W, EXTRACT_H)
        };

        // ── Motion ──
        let motion_magnitude = if let Some(ref prev) = prev_luma {
            compute_motion(prev, &luma)
        } else {
            0.0
        };

        // ── Face ──
        let has_face = detect_skin_tone_upper(frame, EXTRACT_W, EXTRACT_H);

        // ── Focus Point ──
        let (focus_x, focus_y) = compute_focus_point(&luma, EXTRACT_W, EXTRACT_H);

        results.push(SaliencyFrame {
            frame_number,
            timestamp_ms,
            saliency_score,
            motion_magnitude,
            has_face,
            focus_x,
            focus_y,
        });

        prev_luma = Some(luma);
    }

    eprintln!(
        "[saliency] Analysis complete: {} frames ({:.1}s), CNN={}",
        results.len(),
        duration_ms / 1000.0,
        session.is_some()
    );

    Ok(results)
}

/// Run MobileNet CNN inference on a single frame to compute saliency.
fn run_cnn_saliency(session: &mut Session, rgb: &[u8], width: usize, height: usize) -> Option<f64> {
    // Preprocess: RGB → normalised float array
    let mut data = vec![0.0f32; 3 * MODEL_SIZE * MODEL_SIZE];

    for y in 0..MODEL_SIZE.min(height) {
        for x in 0..MODEL_SIZE.min(width) {
            let src_idx = (y * width + x) * 3;
            if src_idx + 2 < rgb.len() {
                let r = rgb[src_idx] as f32 / 255.0;
                let g = rgb[src_idx + 1] as f32 / 255.0;
                let b = rgb[src_idx + 2] as f32 / 255.0;

                let pixel_idx = y * MODEL_SIZE + x;
                data[0 * MODEL_SIZE * MODEL_SIZE + pixel_idx] =
                    (r - IMAGENET_MEAN[0]) / IMAGENET_STD[0];
                data[1 * MODEL_SIZE * MODEL_SIZE + pixel_idx] =
                    (g - IMAGENET_MEAN[1]) / IMAGENET_STD[1];
                data[2 * MODEL_SIZE * MODEL_SIZE + pixel_idx] =
                    (b - IMAGENET_MEAN[2]) / IMAGENET_STD[2];
            }
        }
    }

    // Create ONNX Runtime input using TensorRef with (shape, &slice)
    let ort_input = match TensorRef::from_array_view(
        ([1usize, 3, MODEL_SIZE, MODEL_SIZE], data.as_slice()),
    ) {
        Ok(v) => v,
        Err(e) => {
            eprintln!("[saliency] CNN input error: {e}");
            return None;
        }
    };

    // Run inference
    let outputs = match session.run(ort::inputs![ort_input]) {
        Ok(o) => o,
        Err(e) => {
            eprintln!("[saliency] CNN inference error: {e}");
            return None;
        }
    };

    // Extract logits — try_extract_tensor returns (&Shape, &[f32])
    let (_shape, logits) = match outputs[0].try_extract_tensor::<f32>() {
        Ok(t) => t,
        Err(e) => {
            eprintln!("[saliency] CNN output extraction error: {e}");
            return None;
        }
    };

    Some(compute_saliency_from_logits(logits))
}

/// Spatial contrast heuristic (fallback when CNN is unavailable).
fn compute_spatial_contrast_heuristic(luma: &[f64], width: usize, height: usize) -> f64 {
    let block = 8;
    let mut total_std = 0.0;
    let mut n_blocks = 0;

    for by in (0..height).step_by(block) {
        for bx in (0..width).step_by(block) {
            let mut sum = 0.0;
            let mut sum_sq = 0.0;
            let mut count = 0.0;

            for dy in 0..block.min(height - by) {
                for dx in 0..block.min(width - bx) {
                    let v = luma[(by + dy) * width + (bx + dx)];
                    sum += v;
                    sum_sq += v * v;
                    count += 1.0;
                }
            }

            if count > 1.0 {
                let mean = sum / count;
                let var = (sum_sq / count) - (mean * mean);
                total_std += var.max(0.0).sqrt();
                n_blocks += 1;
            }
        }
    }

    if n_blocks == 0 {
        return 0.0;
    }

    (total_std / n_blocks as f64 / 80.0).min(1.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn focus_point_uniform_image_returns_center() {
        let width = 16;
        let height = 16;
        let luma = vec![128.0; width * height];
        let (fx, fy) = compute_focus_point(&luma, width, height);
        // Uniform image → all blocks have zero variance → fallback (0.5, 0.5)
        assert!((fx - 0.5).abs() < 0.01);
        assert!((fy - 0.5).abs() < 0.01);
    }

    #[test]
    fn focus_point_clamped_to_unit_range() {
        // Random luma values
        let width = 32;
        let height = 32;
        let luma: Vec<f64> = (0..width * height)
            .map(|i| (i as f64 * 7.3) % 256.0)
            .collect();
        let (fx, fy) = compute_focus_point(&luma, width, height);
        assert!(fx >= 0.0 && fx <= 1.0, "focusX out of range: {fx}");
        assert!(fy >= 0.0 && fy <= 1.0, "focusY out of range: {fy}");
    }

    #[test]
    fn saliency_from_empty_logits() {
        assert!((compute_saliency_from_logits(&[]) - 0.5).abs() < 0.01);
    }

    #[test]
    fn saliency_from_logits_bounded() {
        let logits: Vec<f32> = (0..1000).map(|i| (i as f32 - 500.0) / 100.0).collect();
        let score = compute_saliency_from_logits(&logits);
        assert!(score >= 0.0 && score <= 1.0, "Score out of range: {score}");
    }

    #[test]
    fn saliency_confident_prediction_is_high() {
        // One class has a very high logit → high max prob → high saliency
        let mut logits = vec![0.0f32; 100];
        logits[50] = 20.0;
        let score = compute_saliency_from_logits(&logits);
        assert!(score > 0.7, "Confident prediction should be salient: {score}");
    }

    #[test]
    fn saliency_uniform_prediction_is_low() {
        // All logits equal → low max prob → low saliency
        let logits = vec![1.0f32; 1000];
        let score = compute_saliency_from_logits(&logits);
        assert!(score < 0.3, "Uniform prediction should have low saliency: {score}");
    }

    #[test]
    fn motion_identical_frames_zero() {
        let frame = vec![100.0; 256];
        assert!((compute_motion(&frame, &frame) - 0.0).abs() < 0.001);
    }

    #[test]
    fn motion_different_frames_positive() {
        let prev = vec![0.0; 256];
        let curr = vec![100.0; 256];
        let motion = compute_motion(&prev, &curr);
        assert!(motion > 0.0);
        assert!(motion <= 1.0);
    }

    #[test]
    fn motion_mismatched_lengths_zero() {
        let prev = vec![0.0; 100];
        let curr = vec![100.0; 200];
        assert!((compute_motion(&prev, &curr) - 0.0).abs() < 0.001);
    }

    #[test]
    fn spatial_contrast_uniform_is_low() {
        let width = 16;
        let height = 16;
        let luma = vec![128.0; width * height];
        let score = compute_spatial_contrast_heuristic(&luma, width, height);
        assert!(score < 0.1, "Uniform image should have low contrast: {score}");
    }

    #[test]
    fn spatial_contrast_bounded() {
        let width = 32;
        let height = 32;
        let luma: Vec<f64> = (0..width * height)
            .map(|i| if i % 2 == 0 { 0.0 } else { 255.0 })
            .collect();
        let score = compute_spatial_contrast_heuristic(&luma, width, height);
        assert!(score >= 0.0 && score <= 1.0, "Score out of range: {score}");
    }
}
