use crate::types::{ExportResult, ExportSegment};
use napi::bindgen_prelude::*;
use std::env;
use std::fs;
use std::time::Instant;
use tokio::process::Command as TokioCommand;

/// Smart Export: concatenate video segments using ffmpeg,
/// re-muxing GOP-aligned segments and only re-encoding at cut boundaries.
pub async fn smart_export(
    segments: Vec<ExportSegment>,
    output_file: String,
) -> Result<ExportResult> {
    if segments.is_empty() {
        return Err(Error::new(
            Status::InvalidArg,
            "No segments provided for export",
        ));
    }

    let _start_time = Instant::now();
    let temp_dir = env::temp_dir().join(format!(
        "yt_editor_export_{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis()
    ));
    fs::create_dir_all(&temp_dir).map_err(|e| {
        Error::new(
            Status::GenericFailure,
            format!("Failed to create temp dir: {}", e),
        )
    })?;

    let mut concat_lines = Vec::new();
    let mut total_duration_ms = 0.0_f64;
    let mut segments_remuxed = 0_u32;
    let mut segments_reencoded = 0_u32;

    for (i, segment) in segments.iter().enumerate() {
        let seg_duration = segment.end_ms - segment.start_ms;
        total_duration_ms += seg_duration;

        let temp_file = temp_dir.join(format!("segment_{}.mp4", i));

        let start_sec = segment.start_ms / 1000.0;
        let duration_sec = seg_duration / 1000.0;

        let mut cmd = TokioCommand::new("ffmpeg");
        cmd.arg("-y")
            .arg("-ss")
            .arg(format!("{:.3}", start_sec))
            .arg("-t")
            .arg(format!("{:.3}", duration_sec))
            .arg("-i")
            .arg(&segment.source_file);

        if segment.needs_reencode {
            cmd.arg("-c:v")
                .arg("libx264")
                .arg("-preset")
                .arg("fast")
                .arg("-c:a")
                .arg("aac");
            segments_reencoded += 1;
        } else {
            cmd.arg("-c").arg("copy");
            segments_remuxed += 1;
        }

        cmd.arg("-avoid_negative_ts").arg("make_zero");
        cmd.arg(temp_file.to_str().unwrap());

        let output = cmd.output().await.map_err(|e| {
            Error::new(
                Status::GenericFailure,
                format!("Failed to run ffmpeg: {}", e),
            )
        })?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(Error::new(
                Status::GenericFailure,
                format!("FFmpeg segment error: {}", stderr),
            ));
        }

        let path_str = temp_file.to_string_lossy().replace('\\', "/");
        // Escape single quotes for ffmpeg concat demuxer
        let escaped = path_str.replace('\'', "'\\''");
        concat_lines.push(format!("file '{}'", escaped));
    }

    let concat_file = temp_dir.join("concat.txt");
    fs::write(&concat_file, concat_lines.join("\n")).map_err(|e| {
        Error::new(
            Status::GenericFailure,
            format!("Failed to write concat file: {}", e),
        )
    })?;

    let mut concat_cmd = TokioCommand::new("ffmpeg");
    concat_cmd
        .arg("-y")
        .arg("-f")
        .arg("concat")
        .arg("-safe")
        .arg("0")
        .arg("-i")
        .arg(&concat_file)
        .arg("-c")
        .arg("copy")
        .arg(&output_file);

    let concat_output = concat_cmd.output().await.map_err(|e| {
        Error::new(
            Status::GenericFailure,
            format!("Failed to run ffmpeg concat: {}", e),
        )
    })?;

    if !concat_output.status.success() {
        let stderr = String::from_utf8_lossy(&concat_output.stderr);
        return Err(Error::new(
            Status::GenericFailure,
            format!("FFmpeg concat error: {}", stderr),
        ));
    }

    let _ = fs::remove_dir_all(&temp_dir);

    let total_segments = segments.len() as f64;
    let remux_fraction = segments_remuxed as f64 / total_segments;
    let reencode_fraction = segments_reencoded as f64 / total_segments;
    let effective_work = reencode_fraction * 1.0 + remux_fraction * 0.01;
    let speedup_factor = if effective_work > 0.0 {
        (1.0 / effective_work).min(100.0)
    } else {
        100.0
    };

    Ok(ExportResult {
        output_file,
        total_duration_ms,
        segments_remuxed,
        segments_reencoded,
        speedup_factor,
    })
}
