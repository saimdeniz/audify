export const MAX_WAVEFORM_ZOOM = 32;
const WHEEL_NOTCH_PX = 100;
const WHEEL_NOTCH_FACTOR = 1.28;

export interface WaveformViewport {
  zoom: number;
  startRatio: number;
}

export const DEFAULT_WAVEFORM_VIEWPORT: WaveformViewport = {
  zoom: 1,
  startRatio: 0,
};

/**
 * Converts a browser `WheelEvent` (`deltaY`, `deltaMode`) into a smooth exponential
 * zoom factor. Standard 100px mouse notches keep the crisp 1.28x step while high-frequency
 * precision touchpads scale proportionally instead of jumping to max zoom.
 */
export function computeWheelZoomFactor(
  deltaY: number,
  deltaMode = 0
): number {
  if (!Number.isFinite(deltaY) || Math.abs(deltaY) < 0.01) return 1;
  let deltaPx = deltaY;
  if (deltaMode === 1) {
    deltaPx = deltaY * (WHEEL_NOTCH_PX / 3);
  } else if (deltaMode === 2) {
    deltaPx = deltaY * 240;
  }
  const clampedPx = Math.max(-300, Math.min(300, deltaPx));
  return Math.pow(WHEEL_NOTCH_FACTOR, -clampedPx / WHEEL_NOTCH_PX);
}

export function clampWaveformViewport(
  zoom: number,
  startRatio: number
): WaveformViewport {
  const safeZoom =
    !Number.isFinite(zoom) || zoom <= 1.03
      ? 1
      : Math.min(MAX_WAVEFORM_ZOOM, zoom);
  const maxStart = Math.max(0, 1 - 1 / safeZoom);
  const safeStart =
    safeZoom <= 1 || !Number.isFinite(startRatio)
      ? 0
      : Math.max(0, Math.min(maxStart, startRatio));
  return { zoom: safeZoom, startRatio: safeStart };
}

export function screenRatioToTrackRatio(
  screenRatio: number,
  viewport: WaveformViewport
): number {
  const span = 1 / Math.max(1, viewport.zoom);
  const clampedScreen = Math.max(0, Math.min(1, screenRatio));
  return Math.max(0, Math.min(1, viewport.startRatio + clampedScreen * span));
}

export function trackRatioToScreenRatio(
  trackRatio: number,
  viewport: WaveformViewport
): number {
  const span = 1 / Math.max(1, viewport.zoom);
  return (trackRatio - viewport.startRatio) / span;
}

export function zoomWaveformViewportAt(
  viewport: WaveformViewport,
  cursorScreenRatio: number,
  zoomFactor: number
): WaveformViewport {
  const clampedCursor = Math.max(0, Math.min(1, cursorScreenRatio));
  const anchorTrackRatio = screenRatioToTrackRatio(clampedCursor, viewport);
  const targetZoom = viewport.zoom * zoomFactor;
  if (!Number.isFinite(targetZoom) || targetZoom <= 1.03) {
    return DEFAULT_WAVEFORM_VIEWPORT;
  }
  const nextZoom = Math.min(MAX_WAVEFORM_ZOOM, targetZoom);
  const nextSpan = 1 / nextZoom;
  const nextStart = anchorTrackRatio - clampedCursor * nextSpan;
  return clampWaveformViewport(nextZoom, nextStart);
}

export function panWaveformViewportByScreenDelta(
  viewport: WaveformViewport,
  deltaScreenRatio: number
): WaveformViewport {
  if (viewport.zoom <= 1) return DEFAULT_WAVEFORM_VIEWPORT;
  const span = 1 / viewport.zoom;
  return clampWaveformViewport(
    viewport.zoom,
    viewport.startRatio + deltaScreenRatio * span
  );
}
