use crate::types::SceneChange;
use tokio::process::Command as TokioCommand;

/// Default scene change detection threshold (0.0–1.0).
/// Lower = more sensitive, higher = fewer detections.
const DEFAULT_THRESHOLD: f64 = 0.3;

/// Detect scene changes in a video file using ffmpeg's scene detection filter.
///
/// Uses `select='gt(scene,T)'` + `showinfo` to find frames where the
/// scene change score exceeds the threshold, then parses pts_time from
/// the ffmpeg stderr output.
pub async fn detect_scenes(
    video_path: &str,
    fps: f64,
    threshold: Option<f64>,
) -> anyhow::Result<Vec<SceneChange>> {
    let thresh = threshold.unwrap_or(DEFAULT_THRESHOLD);

    // Run ffmpeg with select filter + showinfo to get scene change frames
    let output = TokioCommand::new("ffmpeg")
        .args([
            "-i",
            video_path,
            "-vf",
            &format!("select='gt(scene\\,{thresh})',showinfo"),
            "-vsync",
            "vfr",
            "-f",
            "null",
            "-",
        ])
        .output()
        .await
        .map_err(|e| anyhow::anyhow!("Failed to run ffmpeg for scene detection: {e}"))?;

    // ffmpeg writes filter output to stderr
    let stderr = String::from_utf8_lossy(&output.stderr);
    let mut scenes: Vec<SceneChange> = Vec::new();

    for line in stderr.lines() {
        // showinfo lines look like:
        // [Parsed_showinfo_1 ...] n:  12 pts: ... pts_time:3.456  ...
        if !line.contains("Parsed_showinfo") && !line.contains("showinfo") {
            continue;
        }
        if !line.contains("pts_time:") {
            continue;
        }

        if let Some(pts_time) = extract_pts_time(line) {
            let frame_number = (pts_time * fps).round() as u32;

            // The select filter already guarantees score > threshold,
            // but the exact score isn't in showinfo output, so we
            // set a reasonable estimate based on frame position
            let score = thresh + 0.1; // conservative estimate

            scenes.push(SceneChange {
                frame_number,
                timestamp_ms: pts_time * 1000.0,
                score,
            });
        }
    }

    // If the select+showinfo approach didn't work (older ffmpeg),
    // fall back to parsing scdet filter output
    if scenes.is_empty() {
        scenes = detect_scenes_scdet(video_path, fps, thresh).await?;
    }

    eprintln!(
        "[scene] Detected {} scene changes in {}",
        scenes.len(),
        video_path
    );

    Ok(scenes)
}

/// Fallback: use ffmpeg's `scdet` filter which explicitly logs scene scores.
async fn detect_scenes_scdet(
    video_path: &str,
    fps: f64,
    threshold: f64,
) -> anyhow::Result<Vec<SceneChange>> {
    let score_threshold = (threshold * 100.0).round() as i64; // scdet expects 0–100

    let output = TokioCommand::new("ffmpeg")
        .args([
            "-i",
            video_path,
            "-vf",
            &format!("scdet=threshold={score_threshold}:sc_pass=1"),
            "-f",
            "null",
            "-",
        ])
        .output()
        .await
        .map_err(|e| anyhow::anyhow!("Failed to run ffmpeg scdet: {e}"))?;

    let stderr = String::from_utf8_lossy(&output.stderr);
    let mut scenes: Vec<SceneChange> = Vec::new();

    for line in stderr.lines() {
        // scdet output: [scdet @ 0x...] lavfi.scd.score=34.56 lavfi.scd.time=5.233
        if !line.contains("lavfi.scd.") {
            continue;
        }

        let score = extract_field_f64(line, "lavfi.scd.score=");
        let time = extract_field_f64(line, "lavfi.scd.time=");

        if let (Some(score), Some(time)) = (score, time) {
            scenes.push(SceneChange {
                frame_number: (time * fps).round() as u32,
                timestamp_ms: time * 1000.0,
                score: score / 100.0, // normalize to 0.0–1.0
            });
        }
    }

    Ok(scenes)
}

/// Extract pts_time value from a showinfo log line.
fn extract_pts_time(line: &str) -> Option<f64> {
    let marker = "pts_time:";
    let idx = line.find(marker)?;
    let rest = &line[idx + marker.len()..];
    let value_str = rest.split_whitespace().next()?;
    value_str.parse::<f64>().ok()
}

/// Extract a floating-point value from a key=value pair in a log line.
fn extract_field_f64(line: &str, field: &str) -> Option<f64> {
    let idx = line.find(field)?;
    let rest = &line[idx + field.len()..];
    let value_str = rest.split(|c: char| !c.is_ascii_digit() && c != '.' && c != '-').next()?;
    value_str.parse::<f64>().ok()
}
