use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

pub const LAYER_MIX_SAMPLE_RATE: u32 = 48_000;
pub const MAX_LAYER_LANES: usize = 64;
pub const MAX_LAYER_CLIPS: usize = 256;
pub const MAX_LAYER_DURATION_SEC: f64 = 300.0;
/// Caps cumulative rendered+stretched clip seconds per mix to prevent CPU/RAM DoS.
const MAX_TOTAL_CLIP_WORK_SEC: f64 = MAX_LAYER_DURATION_SEC * 16.0;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LayerLaneSpec {
    pub id: String,
    pub name: String,
    pub color_hex: String,
    #[serde(default)]
    pub volume_db: f32,
    #[serde(default)]
    pub muted: bool,
    #[serde(default)]
    pub solo: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum LayerPitchMode {
    /// Time-preserving Phase Vocoder pitch shift (DaVinci / NLE default):
    /// clip duration on the timeline never changes when pitching ±24st.
    #[default]
    Preserve,
    /// Classic tape-style varispeed resampling: pitching up shortens the clip,
    /// pitching down lengthens it with zero time-stretch artifacts.
    Varispeed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LayerClipSpec {
    pub id: String,
    pub lane_id: String,
    #[serde(default)]
    pub source_sample_id: Option<i64>,
    pub source_path: String,
    #[serde(default)]
    pub source_name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_duration_sec: Option<f64>,
    pub start_sec: f64,
    #[serde(default)]
    pub trim_start_sec: f64,
    pub trim_end_sec: f64,
    #[serde(default)]
    pub fade_in_sec: f64,
    #[serde(default)]
    pub fade_out_sec: f64,
    #[serde(default)]
    pub gain_db: f32,
    #[serde(default)]
    pub pitch_semitones: f32,
    #[serde(default)]
    pub pitch_mode: LayerPitchMode,
    #[serde(default)]
    pub reversed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LayerRecipe {
    #[serde(default = "default_recipe_version")]
    pub version: u32,
    pub lanes: Vec<LayerLaneSpec>,
    pub clips: Vec<LayerClipSpec>,
    #[serde(default)]
    pub master_gain_db: f32,
    #[serde(default = "default_true")]
    pub snap_enabled: bool,
    #[serde(default = "default_snap_grid")]
    pub snap_grid_sec: f64,
}

fn default_recipe_version() -> u32 {
    1
}
fn default_true() -> bool {
    true
}
fn default_snap_grid() -> f64 {
    0.1
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LanePeaksPreview {
    pub lane_id: String,
    pub color_hex: String,
    pub muted: bool,
    pub solo: bool,
    pub peaks: Vec<f32>,
}

#[derive(Debug, Clone)]
pub struct RenderedLayerMix {
    pub samples: Vec<f32>,
    pub sample_rate: u32,
    pub total_frames: u64,
    pub duration_sec: f64,
    pub max_source_bit_depth: u32,
    pub master_peaks: Vec<f32>,
    pub lane_peaks: Vec<LanePeaksPreview>,
    pub peak_db: f32,
    pub clipped: bool,
}

#[inline]
pub fn db_to_linear(db: f32) -> f32 {
    if !db.is_finite() || db <= -59.9 {
        0.0
    } else {
        10.0_f32.powf(db / 20.0)
    }
}

#[inline]
pub fn linear_to_db(peak: f32) -> f32 {
    if !peak.is_finite() || peak <= 1e-6 {
        -96.0
    } else {
        (20.0 * peak.log10()).max(-96.0)
    }
}

fn sanitize_hex_color(raw: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.len() == 7
        && trimmed.starts_with('#')
        && trimmed[1..].chars().all(|c| c.is_ascii_hexdigit())
    {
        trimmed.to_ascii_uppercase()
    } else {
        "#38BDF8".to_string()
    }
}

pub fn validate_and_normalize_recipe(recipe: &LayerRecipe) -> Result<LayerRecipe, String> {
    if recipe.lanes.is_empty() {
        return Err("Layer recipe must contain at least one lane".to_string());
    }
    if recipe.lanes.len() > MAX_LAYER_LANES {
        return Err(format!(
            "Layer recipe exceeds maximum of {} lanes",
            MAX_LAYER_LANES
        ));
    }
    if recipe.clips.len() > MAX_LAYER_CLIPS {
        return Err(format!(
            "Layer recipe exceeds maximum of {} clips",
            MAX_LAYER_CLIPS
        ));
    }

    let mut lanes = Vec::with_capacity(recipe.lanes.len());
    let mut lane_ids = HashMap::with_capacity(recipe.lanes.len());
    for (idx, lane) in recipe.lanes.iter().enumerate() {
        let id = lane.id.trim().to_string();
        if id.is_empty() || id.len() > 64 {
            return Err("Invalid lane identifier".to_string());
        }
        if lane_ids.insert(id.clone(), idx).is_some() {
            return Err("Duplicate lane identifier in recipe".to_string());
        }
        let name = lane.name.trim();
        let clean_name = if name.is_empty() {
            format!("Lane {}", idx + 1)
        } else {
            name.chars().take(64).collect()
        };
        let volume_db = if lane.volume_db.is_finite() {
            lane.volume_db.clamp(-60.0, 12.0)
        } else {
            0.0
        };
        lanes.push(LayerLaneSpec {
            id,
            name: clean_name,
            color_hex: sanitize_hex_color(&lane.color_hex),
            volume_db,
            muted: lane.muted,
            solo: lane.solo,
        });
    }

    let mut clips = Vec::with_capacity(recipe.clips.len());
    let mut seen_clip_ids = HashSet::with_capacity(recipe.clips.len());
    let mut cumulative_work_sec = 0.0_f64;

    for clip in &recipe.clips {
        let id = clip.id.trim().to_string();
        let lane_id = clip.lane_id.trim().to_string();
        if id.is_empty() || id.len() > 64 || !lane_ids.contains_key(&lane_id) {
            return Err("Clip references an invalid or missing lane".to_string());
        }
        if !seen_clip_ids.insert(id.clone()) {
            return Err("Duplicate clip identifier in recipe".to_string());
        }
        if !clip.start_sec.is_finite()
            || !clip.trim_start_sec.is_finite()
            || !clip.trim_end_sec.is_finite()
            || !clip.fade_in_sec.is_finite()
            || !clip.fade_out_sec.is_finite()
        {
            return Err("Clip timings must be finite numbers".to_string());
        }
        let start_sec = clip.start_sec.max(0.0);
        let trim_start_sec = clip.trim_start_sec.max(0.0);
        let trim_end_sec = clip.trim_end_sec.max(trim_start_sec);
        let source_span = trim_end_sec - trim_start_sec;
        if source_span > MAX_LAYER_DURATION_SEC {
            return Err(format!(
                "Clip duration exceeds maximum of {:.0}s",
                MAX_LAYER_DURATION_SEC
            ));
        }
        if start_sec > MAX_LAYER_DURATION_SEC {
            return Err(format!(
                "Clip start exceeds maximum duration of {:.0}s",
                MAX_LAYER_DURATION_SEC
            ));
        }
        let pitch_semitones = if clip.pitch_semitones.is_finite() {
            clip.pitch_semitones.clamp(-24.0, 24.0)
        } else {
            0.0
        };
        let pitch_ratio = if pitch_semitones.abs() >= 0.01 {
            2.0_f64.powf((pitch_semitones as f64) / 12.0)
        } else {
            1.0
        };
        let work_factor = match clip.pitch_mode {
            LayerPitchMode::Preserve if (pitch_ratio - 1.0).abs() > 1e-5 => pitch_ratio.max(1.0),
            LayerPitchMode::Varispeed if (pitch_ratio - 1.0).abs() > 1e-5 => {
                (1.0 / pitch_ratio).max(1.0)
            }
            _ => 1.0,
        };
        cumulative_work_sec += source_span.max(0.05) * work_factor;
        if cumulative_work_sec > MAX_TOTAL_CLIP_WORK_SEC {
            return Err("Layer mix exceeds total audio processing budget".to_string());
        }

        let source_duration_sec = clip
            .source_duration_sec
            .filter(|d| d.is_finite() && *d > 0.0 && *d <= 86_400.0);

        clips.push(LayerClipSpec {
            id,
            lane_id,
            source_sample_id: clip.source_sample_id,
            source_path: clip.source_path.trim().to_string(),
            source_name: clip.source_name.trim().chars().take(160).collect(),
            source_duration_sec,
            start_sec,
            trim_start_sec,
            trim_end_sec,
            fade_in_sec: clip.fade_in_sec.max(0.0),
            fade_out_sec: clip.fade_out_sec.max(0.0),
            gain_db: if clip.gain_db.is_finite() {
                clip.gain_db.clamp(-48.0, 18.0)
            } else {
                0.0
            },
            pitch_semitones,
            pitch_mode: clip.pitch_mode,
            reversed: clip.reversed,
        });
    }

    let master_gain_db = if recipe.master_gain_db.is_finite() {
        recipe.master_gain_db.clamp(-24.0, 12.0)
    } else {
        0.0
    };
    let snap_grid_sec = if recipe.snap_grid_sec.is_finite() {
        recipe.snap_grid_sec.clamp(0.01, 2.0)
    } else {
        0.1
    };

    Ok(LayerRecipe {
        version: 1,
        lanes,
        clips,
        master_gain_db,
        snap_enabled: recipe.snap_enabled,
        snap_grid_sec,
    })
}
