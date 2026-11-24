import { useSampleStore } from "../../store/useSampleStore";
import type { SampleItem, SliceRange } from "../../types";
import {
  beginDragOnMove,
  isOsDragCurrentlyInFlight,
  setActiveOsDragSample,
  startNativePitchedSampleDrag,
  startNativeSampleDrag,
  startNativeSliceDrag,
} from "../../utils/drag";

/**
 * Starts a native OS WAV slice drag from the waveform slice badge or deck header,
 * syncing Session Bin auto-add and Slice History recording on external drop.
 */
export function startDeckSliceDrag(
  sample: SampleItem,
  range: SliceRange,
  clientX: number,
  clientY: number
): void {
  beginDragOnMove(clientX, clientY, () => {
    const st = useSampleStore.getState();
    const dur = Math.max(0.05, range.endSec - range.startSec).toFixed(2);
    const label = `Slice (${dur}s) · ${sample.file_name}`;
    void startNativeSliceDrag(
      sample.file_path,
      range.startSec,
      range.endSec,
      label,
      {
        pitchSemitones: st.pitchSemitones,
        applyMicroFade: st.sliceMicroFade,
        exportPreset: st.exportAudioPreset,
        loudnessMode: st.exportLoudnessMode,
      }
    ).then((res) => {
      if (res?.droppedExternally && st.autoBinOnNleDrag && sample.id > 0) {
        useSampleStore.getState().addSamplesToBin([sample.id]);
      }
      if (res?.droppedExternally) {
        void useSampleStore.getState().recordSliceExport({
          slicePath: res.exportedPath,
          sourceSampleId: sample.id > 0 ? sample.id : null,
          sourceFilePath: sample.file_path,
          startSec: range.startSec,
          endSec: range.endSec,
          pitchSemitones: st.pitchSemitones,
          applyMicroFade: st.sliceMicroFade,
        });
        useSampleStore
          .getState()
          .setStatusMessage(`Exported slice (${dur}s) to timeline`);
      }
    });
  });
}

/**
 * Starts a direct drag from `WaveformDeckHeader` filename handle:
 * - Active slice -> exports & drags the WAV slice.
 * - Active pitch shift (or loudness norm) -> exports & drags the rendered WAV.
 * - Otherwise -> drags the original file (supporting both external NLE/DAW & in-app sidebar drops).
 */
export function startDeckHeaderSampleDrag(
  sample: SampleItem,
  range: SliceRange | null,
  clientX: number,
  clientY: number
): void {
  if (range && range.endSec - range.startSec > 0.03) {
    startDeckSliceDrag(sample, range, clientX, clientY);
    return;
  }

  beginDragOnMove(clientX, clientY, () => {
    const st = useSampleStore.getState();
    if (sample.id > 0) {
      setActiveOsDragSample(sample, true, "deck-header");
      st.setInAppDragSample(sample, { single: true, origin: "deck-header" });
    }
    const withinRenderLimit =
      sample.duration_ms > 0 && sample.duration_ms <= 600_000;
    const shouldRenderWav =
      withinRenderLimit &&
      (Math.abs(st.pitchSemitones) >= 0.01 ||
        st.exportLoudnessMode !== "off");
    const dragPromise = shouldRenderWav
      ? startNativePitchedSampleDrag(
          sample,
          st.pitchSemitones,
          st.sliceMicroFade,
          st.exportLoudnessMode
        )
      : startNativeSampleDrag([sample.file_path], sample.file_name);

    void dragPromise
      .then((droppedExternally) => {
        if (droppedExternally && st.autoBinOnNleDrag && sample.id > 0) {
          useSampleStore.getState().addSamplesToBin([sample.id]);
        }
      })
      .finally(() => {
        window.setTimeout(() => {
          if (!isOsDragCurrentlyInFlight()) {
            setActiveOsDragSample(null);
            useSampleStore.getState().setInAppDragSample(null);
          }
        }, 140);
      });
  });
}
