use napi_derive::napi;
use serde::{Deserialize, Serialize};

#[napi(object)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranscriptWord {
    pub text: String,
    pub start_ms: f64,
    pub end_ms: f64,
    pub confidence: f64,
}

#[napi(object)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranscriptSegment {
    pub id: u32,
    pub start_ms: f64,
    pub end_ms: f64,
    pub text: String,
    pub words: Vec<TranscriptWord>,
}

#[napi(object)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SceneChange {
    pub frame_number: u32,
    pub timestamp_ms: f64,
    pub score: f64,
}

#[napi(object)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SilentPause {
    pub start_ms: f64,
    pub end_ms: f64,
    pub duration_ms: f64,
}

#[napi(object)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SaliencyFrame {
    pub frame_number: u32,
    pub timestamp_ms: f64,
    pub saliency_score: f64,
    pub motion_magnitude: f64,
    pub has_face: bool,
    pub focus_x: f64,
    pub focus_y: f64,
}

#[napi(object)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AudioBeat {
    pub timestamp_ms: f64,
    pub strength: f64,
    pub bpm: Option<f64>,
}

#[napi(object)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MetadataManifest {
    pub source_file: String,
    pub duration_ms: f64,
    pub fps: f64,
    pub width: u32,
    pub height: u32,
    pub transcript: Vec<TranscriptSegment>,
    pub scene_changes: Vec<SceneChange>,
    pub silent_pauses: Vec<SilentPause>,
    pub saliency_map: Vec<SaliencyFrame>,
    pub audio_beats: Vec<AudioBeat>,
}

#[napi(object)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportSegment {
    pub source_file: String,
    pub start_ms: f64,
    pub end_ms: f64,
    pub needs_reencode: bool,
}

#[napi(object)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportResult {
    pub output_file: String,
    pub total_duration_ms: f64,
    pub segments_remuxed: u32,
    pub segments_reencoded: u32,
    pub speedup_factor: f64,
}
