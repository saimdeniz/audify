export const MAX_WAVEFORM_ZOOM = 32;

export interface WaveformViewport {
  zoom: number;
  startRatio: number;
}

export const DEFAULT_WAVEFORM_VIEWPORT: WaveformViewport = {
  zoom: 1,
  startRatio: 0,
};

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
