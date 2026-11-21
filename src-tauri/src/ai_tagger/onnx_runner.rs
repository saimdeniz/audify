use super::types::AI_EMBEDDING_DIM;
use ort::{
    environment::Environment,
    session::{builder::GraphOptimizationLevel, Session},
    value::Tensor,
};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

pub const YAMNET_NUM_CLASSES: usize = 521;
/// YAMNet processes 0.96s (15,360 samples) frames stepped by 0.48s (7,680 samples) at 16 kHz.
const YAMNET_HOP_SAMPLES: usize = 7_680;

#[derive(Debug, Clone)]
pub struct AiInferenceOutput {
    pub embedding: [f32; AI_EMBEDDING_DIM],
    pub class_scores: Vec<f32>,
}

pub struct LoadedOnnxModel {
    pub model_id: String,
    pub model_path: PathBuf,
    pub runtime_dll_path: PathBuf,
    pub input_name: String,
    pub scores_output_idx: usize,
    pub embeddings_output_idx: Option<usize>,
    pub session: Mutex<Session>,
}

static ORT_ENV: OnceLock<Environment> = OnceLock::new();
static ORT_INIT_LOCK: Mutex<()> = Mutex::new(());

pub fn ensure_ort_environment(runtime_dll_path: &Path) -> Result<&'static Environment, String> {
    if let Some(env) = ORT_ENV.get() {
        return Ok(env);
    }
    let _guard = ORT_INIT_LOCK
        .lock()
        .map_err(|_| "ONNX initialization lock poisoned".to_string())?;
    if let Some(env) = ORT_ENV.get() {
        return Ok(env);
    }
    if !runtime_dll_path.is_file() {
        return Err("ONNX Runtime DLL is missing from user/models/bin".to_string());
    }
    let env = ort::init_from(runtime_dll_path)
        .map_err(|e| format!("Failed loading ONNX Runtime DLL: {}", e))?
        .with_name("audify-ai")
        .build()
        .map_err(|e| format!("Failed initializing ONNX environment: {}", e))?;

    let _ = ORT_ENV.set(env);
    ORT_ENV
        .get()
        .ok_or_else(|| "ONNX environment registration failed".to_string())
}

impl LoadedOnnxModel {
    pub fn load(
        model_id: &str,
        model_path: &Path,
        runtime_dll_path: &Path,
    ) -> Result<Self, String> {
        let env = ensure_ort_environment(runtime_dll_path)?;
        let threads = std::thread::available_parallelism()
            .map(|p| p.get().clamp(2, 6))
            .unwrap_or(4);

        let session = Session::builder(env)
            .map_err(|e| format!("ONNX session builder failed: {}", e))?
            .with_optimization_level(GraphOptimizationLevel::Level3)
            .map_err(|e| format!("ONNX optimization setup failed: {}", e))?
            .with_intra_threads(threads)
            .map_err(|e| format!("ONNX thread setup failed: {}", e))?
            .commit_from_file(model_path)
            .map_err(|e| format!("Failed loading ONNX model: {}", e))?;

        let input_name = session
            .inputs()
            .first()
            .map(|o| o.name().to_string())
            .ok_or_else(|| "ONNX model has no input tensor".to_string())?;

        let mut scores_output_idx = 0usize;
        let mut embeddings_output_idx = None;
        if session.outputs().is_empty() {
            return Err("ONNX model has no output tensors".to_string());
        }
        for (idx, outlet) in session.outputs().iter().enumerate() {
            let n = outlet.name().to_ascii_lowercase();
            if n.contains("embed") || n == "output_1" {
                embeddings_output_idx = Some(idx);
            } else if n.contains("score") || n == "output_0" {
                scores_output_idx = idx;
            }
        }
        if embeddings_output_idx.is_none() && session.outputs().len() >= 2 {
            embeddings_output_idx = Some(1);
        }

        Ok(Self {
            model_id: model_id.to_string(),
            model_path: model_path.to_path_buf(),
            runtime_dll_path: runtime_dll_path.to_path_buf(),
            input_name,
            scores_output_idx,
            embeddings_output_idx,
            session: Mutex::new(session),
        })
    }

    pub fn infer_waveform(&self, samples_16k: Vec<f32>) -> Result<AiInferenceOutput, String> {
        if samples_16k.is_empty() {
            return Err("Empty waveform passed to ONNX inference".to_string());
        }

        // Summarize hop energies before transferring `samples_16k` into the ONNX input tensor.
        let hop_stats = compute_hop_energy_stats(&samples_16k);
        let input_tensor = Tensor::from_array(([samples_16k.len()], samples_16k))
            .map_err(|e| format!("Failed creating waveform tensor: {}", e))?;

        let mut session = self
            .session
            .lock()
            .map_err(|_| "ONNX session lock poisoned".to_string())?;

        let outputs = session
            .run(ort::inputs![self.input_name.as_str() => input_tensor])
            .map_err(|e| format!("ONNX inference error: {}", e))?;

        if outputs.len() == 0 {
            return Err("ONNX inference returned no output tensors".to_string());
        }
        let scores_outlet = outputs
            .values()
            .nth(self.scores_output_idx)
            .ok_or_else(|| "ONNX class scores output index out of bounds".to_string())?;
        let (scores_shape, scores_flat) = scores_outlet
            .try_extract_tensor::<f32>()
            .map_err(|e| format!("Failed extracting class scores tensor: {}", e))?;

        let class_scores = aggregate_frame_scores(scores_shape.as_ref(), scores_flat);

        let raw_embedding = if let Some(emb_idx) = self.embeddings_output_idx {
            let emb_outlet = outputs
                .values()
                .nth(emb_idx)
                .ok_or_else(|| "ONNX embedding output index out of bounds".to_string())?;
            let (emb_shape, emb_flat) = emb_outlet
                .try_extract_tensor::<f32>()
                .map_err(|e| format!("Failed extracting embedding tensor: {}", e))?;
            energy_weighted_pool_frames(emb_shape.as_ref(), emb_flat, &hop_stats)
        } else {
            class_scores.clone()
        };

        let embedding = project_and_l2_normalize(&raw_embedding);
        Ok(AiInferenceOutput {
            embedding,
            class_scores,
        })
    }
}

/// Aggregates `[frames, classes]` scores using `0.55 * mean + 0.45 * max` so brief transient
/// SFX hits inside multi-second files retain high class confidence without losing global stability.
pub fn aggregate_frame_scores(dims: &[i64], flat: &[f32]) -> Vec<f32> {
    let (frames, cols) = resolve_2d_dims(dims, flat.len(), YAMNET_NUM_CLASSES);
    if frames == 0 || cols == 0 || frames.checked_mul(cols).is_none_or(|t| t > flat.len()) {
        return Vec::new();
    }
    let mut out = vec![0.0_f32; cols];
    for c in 0..cols {
        let mut sum = 0.0_f32;
        let mut max_v = 0.0_f32;
        for f in 0..frames {
            let val = flat[f * cols + c];
            if val.is_finite() && val > 0.0 {
                sum += val;
                if val > max_v {
                    max_v = val;
                }
            }
        }
        let mean_v = sum / (frames as f32);
        out[c] = (0.55 * mean_v + 0.45 * max_v).clamp(0.0, 1.0);
    }
    out
}

pub fn compute_hop_energy_stats(samples_16k: &[f32]) -> Vec<(f64, usize)> {
    samples_16k
        .chunks(YAMNET_HOP_SAMPLES)
        .map(|chunk| {
            let mut sum_sq = 0.0_f64;
            let mut count = 0usize;
            for &s in chunk {
                if s.is_finite() {
                    let v = s as f64;
                    sum_sq += v * v;
                    count += 1;
                }
            }
            (sum_sq, count)
        })
        .collect()
}

/// Pools `[frames, dim]` frame embeddings weighted by each 0.96s frame's acoustic RMS energy
/// (`rms + 0.02 * peak_rms`), falling back cleanly to uniform mean pooling when `hop_stats` is
/// empty or near-silent so quiet reverb tails never dilute transient SFX signatures.
pub fn energy_weighted_pool_frames(
    dims: &[i64],
    flat: &[f32],
    hop_stats: &[(f64, usize)],
) -> Vec<f32> {
    let (frames, cols) = resolve_2d_dims(dims, flat.len(), 1024);
    if frames == 0 || cols == 0 || frames.checked_mul(cols).is_none_or(|t| t > flat.len()) {
        return Vec::new();
    }

    let mut frame_rms = Vec::with_capacity(frames);
    let mut peak_rms = 0.0_f32;
    if !hop_stats.is_empty() {
        for f in 0..frames {
            let (s0, c0) = hop_stats.get(f).copied().unwrap_or((0.0, 0));
            let (s1, c1) = hop_stats.get(f + 1).copied().unwrap_or((0.0, 0));
            let count = c0 + c1;
            let rms = if count > 0 {
                ((s0 + s1) / (count as f64)).sqrt() as f32
            } else {
                0.0
            };
            if rms > peak_rms {
                peak_rms = rms;
            }
            frame_rms.push(rms);
        }
    }

    let mut out = vec![0.0_f32; cols];
    let mut weight_sum = 0.0_f32;
    let floor_weight = 0.02_f32 * peak_rms;

    for f in 0..frames {
        let weight = if peak_rms > 1e-6 && !frame_rms.is_empty() {
            frame_rms[f] + floor_weight
        } else {
            1.0
        };
        weight_sum += weight;
        let base = f * cols;
        for c in 0..cols {
            let v = flat[base + c];
            if v.is_finite() {
                out[c] += v * weight;
            }
        }
    }

    if weight_sum > 0.0 {
        let inv = 1.0_f32 / weight_sum;
        for v in &mut out {
            *v *= inv;
        }
    }
    out
}

#[cfg(test)]
pub fn mean_pool_frames(dims: &[i64], flat: &[f32]) -> Vec<f32> {
    energy_weighted_pool_frames(dims, flat, &[])
}

fn resolve_2d_dims(dims: &[i64], flat_len: usize, default_cols: usize) -> (usize, usize) {
    if flat_len == 0 {
        return (0, 0);
    }
    match dims {
        [rows, cols] => {
            let Ok(r) = usize::try_from(*rows) else {
                return (0, 0);
            };
            let Ok(c) = usize::try_from(*cols) else {
                return (0, 0);
            };
            if r > 0 && c > 0 && r.checked_mul(c).is_some_and(|total| total <= flat_len) {
                (r, c)
            } else {
                (0, 0)
            }
        }
        [cols] => {
            let Ok(c) = usize::try_from(*cols) else {
                return (0, 0);
            };
            if c > 0 && c <= flat_len {
                (1, c)
            } else {
                (0, 0)
            }
        }
        _ => {
            let cols = default_cols.min(flat_len).max(1);
            let frames = flat_len / cols;
            if frames == 0 {
                (0, 0)
            } else {
                (frames, cols)
            }
        }
    }
}

/// Deterministic seeded Johnson-Lindenstrauss Rademacher projection (`in_dim -> 128`) + L2 norm.
/// Preserves cosine similarity rank ordering across arbitrary input sizes without extra assets.
pub fn project_and_l2_normalize(input: &[f32]) -> [f32; AI_EMBEDDING_DIM] {
    let mut out = [0.0_f32; AI_EMBEDDING_DIM];
    if input.is_empty() {
        return out;
    }

    if input.len() == AI_EMBEDDING_DIM {
        for (dst, &src) in out.iter_mut().zip(input.iter()) {
            *dst = if src.is_finite() { src } else { 0.0 };
        }
    } else {
        for (row_idx, dst) in out.iter_mut().enumerate() {
            let mut acc = 0.0_f32;
            let row_seed = (row_idx as u64).wrapping_mul(0x9E37_79B9_7F4A_7C15);
            for (col_idx, &val) in input.iter().enumerate() {
                if !val.is_finite() || val == 0.0 {
                    continue;
                }
                let sign_bit = splitmix64(row_seed ^ (col_idx as u64).wrapping_mul(0xBF58_476D_1CE4_E5B9));
                if (sign_bit & 1) == 0 {
                    acc += val;
                } else {
                    acc -= val;
                }
            }
            *dst = acc;
        }
    }

    l2_normalize_inplace(&mut out);
    out
}

pub fn l2_normalize_inplace(vec: &mut [f32]) {
    let norm_sq: f32 = vec.iter().map(|&v| v * v).sum();
    if norm_sq <= 1e-12 || !norm_sq.is_finite() {
        for v in vec.iter_mut() {
            *v = 0.0;
        }
        return;
    }
    let inv = 1.0_f32 / norm_sq.sqrt();
    for v in vec.iter_mut() {
        *v *= inv;
    }
}

#[inline]
fn splitmix64(mut x: u64) -> u64 {
    x = x.wrapping_add(0x9E37_79B9_7F4A_7C15);
    x = (x ^ (x >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    x = (x ^ (x >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    x ^ (x >> 31)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[ignore = "requires local downloaded user/models/yamnet.onnx and onnxruntime.dll"]
    fn live_yamnet_onnx_signature_and_inference_work() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("user").join("models");
        let model_path = root.join("yamnet.onnx");
        let dll_path = root.join("bin").join("onnxruntime.dll");
        assert!(model_path.is_file(), "missing yamnet.onnx at {:?}", model_path);
        assert!(dll_path.is_file(), "missing onnxruntime.dll at {:?}", dll_path);

        let model = LoadedOnnxModel::load("yamnet-audioset-v1", &model_path, &dll_path)
            .expect("load real yamnet.onnx");
        {
            let sess = model.session.lock().unwrap();
            for (i, inp) in sess.inputs().iter().enumerate() {
                println!("INPUT[{}]: name={:?} dtype={:?}", i, inp.name(), inp.dtype());
            }
            for (i, out) in sess.outputs().iter().enumerate() {
                println!("OUTPUT[{}]: name={:?} dtype={:?}", i, out.name(), out.dtype());
            }
        }
        println!(
            "Chosen input={:?} scores_idx={} embeddings_idx={:?}",
            model.input_name, model.scores_output_idx, model.embeddings_output_idx
        );

        let mut wave = Vec::with_capacity(24_000);
        for i in 0..24_000 {
            let t = (i as f32) / 16_000.0;
            wave.push(0.4 * (2.0 * std::f32::consts::PI * 440.0 * t).sin());
        }
        let out = model.infer_waveform(wave).expect("run real yamnet inference");
        println!(
            "1.5s clip: class_scores.len()={} max_score={:.4} embedding_norm={:.4}",
            out.class_scores.len(),
            out.class_scores.iter().copied().fold(0.0_f32, f32::max),
            out.embedding.iter().map(|v| v * v).sum::<f32>().sqrt()
        );
        assert_eq!(out.class_scores.len(), YAMNET_NUM_CLASSES);

        for (label, len) in [("460ms (7360)", 7360usize), ("150ms (2400)", 2400usize)] {
            let mut short_wave = Vec::with_capacity(len);
            for i in 0..len {
                let t = (i as f32) / 16_000.0;
                short_wave.push(0.5 * (2.0 * std::f32::consts::PI * 220.0 * t).sin());
            }
            let res = model.infer_waveform(short_wave);
            println!("{} result: {:?}", label, res.as_ref().map(|o| (o.class_scores.len(), o.class_scores.iter().copied().fold(0.0_f32, f32::max))));
        }
    }
}
