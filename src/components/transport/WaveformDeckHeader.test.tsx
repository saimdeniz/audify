// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SampleItem } from "../../types";
import { WaveformDeckHeader } from "./WaveformDeckHeader";

function makeSample(overrides: Partial<SampleItem> = {}): SampleItem {
  return {
    id: 1,
    library_id: 1,
    file_path: "D:/SFX/Loop_120_Am.wav",
    file_name: "Loop_120_Am.wav",
    folder_path: "D:/SFX",
    extension: "wav",
    duration_ms: 4000,
    sample_rate: 48000,
    channels: 2,
    bit_depth: 24,
    file_size: 200000,
    is_favorite: false,
    is_loop: true,
    genre: "Electronic",
    artist: "",
    album: "",
    year: "",
    bpm: 120,
    musical_key: "Am",
    camelot_key: "8A",
    peaks_json: "[]",
    created_at: "2026-11-01",
    tags: [],
    ...overrides,
  };
}

describe("WaveformDeckHeader effective varispeed BPM badge", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows transposed key and effective BPM on the pitch pill in normal mode", () => {
    render(
      <WaveformDeckHeader
        selectedSample={makeSample({ bpm: 120, musical_key: "Am" })}
        isMiniDock={false}
        effectiveDuration={4}
        sliceRange={null}
        pitchSemitones={2}
        onResetPitch={vi.fn()}
        onClearSlice={vi.fn()}
      />
    );

    const pill = screen.getByRole("button");
    expect(pill.textContent).toContain(
      "Pitch +2st · Am → Bm · 120 → 134.7 BPM"
    );
    expect(pill.getAttribute("title")).toContain(
      "Effective varispeed BPM: 120 → 134.7"
    );
    expect(pill.getAttribute("title")).toContain(
      "Effective duration: 3.56s (112.2% speed)"
    );
  });

  it("shows effective slice duration in tooltip even without key or BPM", () => {
    render(
      <WaveformDeckHeader
        selectedSample={makeSample({ bpm: undefined, musical_key: "", camelot_key: "" })}
        isMiniDock={false}
        effectiveDuration={4}
        sliceRange={{ startSec: 1.0, endSec: 3.0 }}
        pitchSemitones={-12}
        onResetPitch={vi.fn()}
        onClearSlice={vi.fn()}
      />
    );

    const pill = screen.getByRole("button", { name: /Pitch -12st · WAV/i });
    expect(pill.getAttribute("title")).toContain(
      "Effective slice duration: 4.00s (50.0% speed)"
    );
  });

  it("shows compact effective BPM in Mini Dock mode and BPM-only when key is absent", () => {
    const { rerender } = render(
      <WaveformDeckHeader
        selectedSample={makeSample({ bpm: 120, musical_key: "Am" })}
        isMiniDock={true}
        effectiveDuration={4}
        sliceRange={null}
        pitchSemitones={2}
        onResetPitch={vi.fn()}
        onClearSlice={vi.fn()}
      />
    );

    expect(screen.getByRole("button").textContent).toContain(
      "+2st · Am→Bm · 134.7"
    );

    rerender(
      <WaveformDeckHeader
        selectedSample={makeSample({ bpm: 120, musical_key: "", camelot_key: "" })}
        isMiniDock={false}
        effectiveDuration={4}
        sliceRange={null}
        pitchSemitones={-12}
        onResetPitch={vi.fn()}
        onClearSlice={vi.fn()}
      />
    );

    expect(screen.getByRole("button").textContent).toContain(
      "Pitch -12st · 120 → 60 BPM"
    );
  });

  it("hides pitch pill when pitchSemitones is 0", () => {
    render(
      <WaveformDeckHeader
        selectedSample={makeSample()}
        isMiniDock={false}
        effectiveDuration={4}
        sliceRange={null}
        pitchSemitones={0}
        onResetPitch={vi.fn()}
        onClearSlice={vi.fn()}
      />
    );

    expect(screen.queryByRole("button")).toBeNull();
  });
});
