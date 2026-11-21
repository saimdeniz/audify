use serde::Serialize;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

const PROGRESS_EMIT_INTERVAL: Duration = Duration::from_millis(75);

#[derive(Debug, Clone, Serialize)]
pub struct DuplicateScanProgressPayload {
    pub mode: String,
    pub stage: String,
    pub stage_label: String,
    pub processed: usize,
    pub total: usize,
    pub percentage: f64,
    pub current_file: String,
}

pub type ProgressEmitFn = Arc<dyn Fn(DuplicateScanProgressPayload) + Send + Sync>;

pub(crate) struct PhaseTracker {
    mode: String,
    stage: String,
    stage_label: String,
    min_pct: f64,
    max_pct: f64,
    total: usize,
    processed: AtomicUsize,
    last_emit: Mutex<Option<Instant>>,
    emit_fn: Option<ProgressEmitFn>,
}

impl PhaseTracker {
    pub(crate) fn new(
        mode: &str,
        stage: &str,
        stage_label: &str,
        min_pct: f64,
        max_pct: f64,
        total: usize,
        emit_fn: Option<ProgressEmitFn>,
    ) -> Self {
        Self {
            mode: mode.to_string(),
            stage: stage.to_string(),
            stage_label: stage_label.to_string(),
            min_pct,
            max_pct,
            total,
            processed: AtomicUsize::new(0),
            last_emit: Mutex::new(None),
            emit_fn,
        }
    }

    pub(crate) fn emit_start(&self, label_hint: &str) {
        self.emit_snapshot(0, label_hint);
    }

    pub(crate) fn tick(&self, current_file: &str) {
        let done = self.processed.fetch_add(1, Ordering::Relaxed) + 1;
        if self.emit_fn.is_none() {
            return;
        }
        if done >= self.total {
            self.emit_snapshot(done.min(self.total), current_file);
            return;
        }
        if let Ok(mut guard) = self.last_emit.try_lock() {
            let now = Instant::now();
            let due = guard
                .map(|prev| now.duration_since(prev) >= PROGRESS_EMIT_INTERVAL)
                .unwrap_or(true);
            if due {
                *guard = Some(now);
                drop(guard);
                self.emit_snapshot(done, current_file);
            }
        }
    }

    pub(crate) fn finish(&self, label_hint: &str) {
        self.emit_snapshot(self.total, label_hint);
    }

    fn emit_snapshot(&self, done: usize, current_file: &str) {
        let Some(ref emit) = self.emit_fn else {
            return;
        };
        let ratio = if self.total == 0 {
            1.0
        } else {
            (done.min(self.total) as f64) / (self.total as f64)
        };
        let pct = self.min_pct + ratio * (self.max_pct - self.min_pct);
        emit(DuplicateScanProgressPayload {
            mode: self.mode.clone(),
            stage: self.stage.clone(),
            stage_label: self.stage_label.clone(),
            processed: done.min(self.total),
            total: self.total,
            percentage: pct.clamp(0.0, 100.0),
            current_file: current_file.to_string(),
        });
    }
}
