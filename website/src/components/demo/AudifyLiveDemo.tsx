import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  Folder,
  Hash,
  Minus,
  Music,
  PanelLeft,
  Pause,
  Play,
  Plus,
  Repeat,
  Search,
  SkipBack,
  SkipForward,
  SlidersHorizontal,
  Sparkles,
  Square,
  Star,
  Volume2,
  X,
  Zap,
} from "lucide-react";
import rawSamples from "../../data/demoSamples.generated.json";
import { useI18n } from "../../i18n";
import { demoAudioEngine, type PlaybackSnapshot } from "../../services/demoAudioEngine";
import { Reveal } from "../Reveal";
import { DeckWaveformCanvas } from "./DeckWaveformCanvas";
import { MiniWaveformCanvas } from "./MiniWaveformCanvas";

export interface DemoSample {
  id: string;
  fileName: string;
  src: string;
  folder: string;
  sampleClass: string;
  genre: string;
  tags: string[];
  starred: boolean;
  duration: number;
  sampleRate: number;
  channels: number;
  bitDepth: number;
  format: string;
  sizeBytes: number;
  lufs: number;
  simGroup: string;
  peaks: number[];
}

const SAMPLES: DemoSample[] = rawSamples as DemoSample[];

const TAG_COLORS: Record<string, string> = {
  Impact: "#F97316",
  Explosion: "#EF4444",
  Whoosh: "#06B6D4",
  Air: "#38BDF8",
  Fast: "#22D3EE",
  Sub: "#FB923C",
  Foley: "#10B981",
  Glass: "#34D399",
  Metal: "#14B8A6",
  UI: "#8B5CF6",
  Chime: "#A78BFA",
  "Sci-Fi": "#6366F1",
  Ambience: "#22C55E",
  Wind: "#4ADE80",
  Loop: "#10B981",
  Music: "#A855F7",
  Cinematic: "#F59E0B",
  Piano: "#EC4899",
};

const QUICK_TAGS = ["Impact", "Whoosh", "Foley", "UI", "Ambience", "Music"] as const;

function formatTime(sec: number): string {
  const safe = Math.max(0, sec);
  const mins = Math.floor(safe / 60);
  const rem = safe - mins * 60;
  return `${String(mins).padStart(2, "0")}:${rem.toFixed(2).padStart(5, "0")}`;
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

function computeSimilarityScore(anchor: DemoSample, candidate: DemoSample): number {
  if (anchor.id === candidate.id) return 100;
  let score = 46;
  if (anchor.simGroup === candidate.simGroup) score += 38;
  if (anchor.sampleClass === candidate.sampleClass) score += 8;
  if (anchor.genre === candidate.genre) score += 6;
  const sharedTags = candidate.tags.filter((t) => anchor.tags.includes(t)).length;
  score += sharedTags * 7;
  const durRatio = Math.min(anchor.duration, candidate.duration) / Math.max(anchor.duration, candidate.duration, 0.1);
  score += Math.round(durRatio * 6);
  return Math.min(96, Math.max(34, score));
}

export const AudifyLiveDemo: React.FC = () => {
  const { messages } = useI18n();
  const [selectedId, setSelectedId] = useState<string>(SAMPLES[0].id);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [viewFilter, setViewFilter] = useState<"all" | "favorites">("all");
  const [starredIds, setStarredIds] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(SAMPLES.map((s) => [s.id, s.starred]))
  );
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(false);
  const [similarityAnchorId, setSimilarityAnchorId] = useState<string | null>(null);

  const [pitch, setPitch] = useState<number>(0);
  const [volume, setVolume] = useState<number>(0.85);
  const [loop, setLoop] = useState<boolean>(false);
  const [autoplay, setAutoplay] = useState<boolean>(true);
  const [slice, setSlice] = useState<{ start: number; end: number }>({ start: 0, end: 1 });
  const [snap, setSnap] = useState<PlaybackSnapshot>({
    isPlaying: false,
    sampleId: null,
    currentTime: 0,
    duration: SAMPLES[0].duration,
  });

  useEffect(() => {
    const unsub = demoAudioEngine.subscribe(setSnap);
    return () => {
      unsub();
      demoAudioEngine.stop();
    };
  }, []);

  const selectedSample = useMemo(
    () => SAMPLES.find((s) => s.id === selectedId) ?? SAMPLES[0],
    [selectedId]
  );

  const similarityAnchor = useMemo(
    () => (similarityAnchorId ? SAMPLES.find((s) => s.id === similarityAnchorId) ?? null : null),
    [similarityAnchorId]
  );

  const tagCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const s of SAMPLES) {
      for (const t of s.tags) {
        counts[t] = (counts[t] ?? 0) + 1;
      }
    }
    return counts;
  }, []);

  const visibleSamples = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    let list = SAMPLES.filter((s) => {
      if (viewFilter === "favorites" && !starredIds[s.id]) return false;
      if (activeTag && !s.tags.includes(activeTag)) return false;
      if (!q) return true;
      return (
        s.fileName.toLowerCase().includes(q) ||
        s.genre.toLowerCase().includes(q) ||
        s.sampleClass.toLowerCase().includes(q) ||
        s.tags.some((t) => t.toLowerCase().includes(q))
      );
    });

    if (similarityAnchor) {
      list = [...list].sort(
        (a, b) =>
          computeSimilarityScore(similarityAnchor, b) -
          computeSimilarityScore(similarityAnchor, a)
      );
    }
    return list;
  }, [searchQuery, viewFilter, starredIds, activeTag, similarityAnchor]);

  const playSample = useCallback(
    (sample: DemoSample, startRatio?: number, customSlice?: { start: number; end: number }) => {
      const targetSlice = customSlice ?? (sample.id === selectedId ? slice : { start: 0, end: 1 });
      if (sample.id !== selectedId) {
        setSelectedId(sample.id);
        setSlice({ start: 0, end: 1 });
      }
      void demoAudioEngine.play(sample.id, sample.src, {
        startRatio,
        sliceStart: targetSlice.start,
        sliceEnd: targetSlice.end,
        pitchSemitones: pitch,
        loop,
        volumeLinear: volume,
      });
    },
    [selectedId, slice, pitch, loop, volume]
  );

  const handleTogglePlay = useCallback(() => {
    if (snap.isPlaying && snap.sampleId === selectedSample.id) {
      demoAudioEngine.pause();
    } else {
      playSample(selectedSample);
    }
  }, [snap.isPlaying, snap.sampleId, selectedSample, playSample]);

  const handleSelectRow = useCallback(
    (sample: DemoSample) => {
      const resetSlice = { start: 0, end: 1 };
      setSelectedId(sample.id);
      setSlice(resetSlice);
      if (autoplay) {
        void demoAudioEngine.play(sample.id, sample.src, {
          sliceStart: 0,
          sliceEnd: 1,
          pitchSemitones: pitch,
          loop,
          volumeLinear: volume,
        });
      }
    },
    [autoplay, pitch, loop, volume]
  );

  const handleStepSample = useCallback(
    (delta: number) => {
      if (visibleSamples.length === 0) return;
      const idx = visibleSamples.findIndex((s) => s.id === selectedId);
      const nextIdx = (idx + delta + visibleSamples.length) % visibleSamples.length;
      handleSelectRow(visibleSamples[nextIdx]);
    },
    [visibleSamples, selectedId, handleSelectRow]
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.target instanceof HTMLInputElement) return;
    if (e.code === "Space") {
      e.preventDefault();
      handleTogglePlay();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      handleStepSample(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      handleStepSample(-1);
    } else if (e.key === "Enter" && e.shiftKey) {
      e.preventDefault();
      setSimilarityAnchorId((prev) => (prev === selectedSample.id ? null : selectedSample.id));
    } else if (e.key.toLowerCase() === "i") {
      const dur = selectedSample.duration || 1;
      const ratio = Math.min(slice.end - 0.04, Math.max(0, snap.currentTime / dur));
      const next = { start: ratio, end: slice.end };
      setSlice(next);
      demoAudioEngine.setSlice(next.start, next.end);
    } else if (e.key.toLowerCase() === "o") {
      const dur = selectedSample.duration || 1;
      const ratio = Math.max(slice.start + 0.04, Math.min(1, snap.currentTime / dur));
      const next = { start: slice.start, end: ratio };
      setSlice(next);
      demoAudioEngine.setSlice(next.start, next.end);
    } else if (e.key === "Escape") {
      setSlice({ start: 0, end: 1 });
      demoAudioEngine.setSlice(0, 1);
    }
  };

  const hasSlice = slice.start > 0.005 || slice.end < 0.995;
  const activeTime = snap.sampleId === selectedSample.id ? snap.currentTime : 0;
  const activeDur = selectedSample.duration;
  const dbReadout = volume <= 0.01 ? "-∞ dB" : `${(20 * Math.log10(volume)).toFixed(1)}dB`;
  const favoriteCount = Object.values(starredIds).filter(Boolean).length;

  return (
    <section id="demo" className="relative z-10 py-20 sm:py-24">
      <div className="page-rail">
        {/* Section Heading */}
        <Reveal>
          <div className="mb-8 flex flex-col justify-between gap-4 md:flex-row md:items-end">
            <div>
              <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.14em] text-accent-fg">
                {messages.demo.eyebrow}
              </div>
              <h2 className="text-2xl font-semibold tracking-tight text-fg sm:text-4xl">
                {messages.demo.title}
              </h2>
              <p className="mt-2.5 max-w-2xl text-[14px] leading-relaxed text-fg-2">
                {messages.demo.subtitle}
              </p>
            </div>
            <div className="rounded-[3px] border border-line bg-surface-1 px-2.5 py-1.5 font-mono text-[10px] text-fg-3">
              {messages.demo.hintControls}
            </div>
          </div>
        </Reveal>

        {/* 1:1 Audify Studio Window Replica */}
        <Reveal delayMs={80}>
          <div
            tabIndex={0}
            onKeyDown={handleKeyDown}
            aria-label="Interactive Audify Replica"
            className="relative overflow-hidden rounded-lg border border-line-strong bg-surface-0 shadow-2xl focus:outline-none focus:ring-1 focus:ring-accent"
          >
            {/* 1. Authentic Audify Top Titlebar */}
            <div className="flex h-8 items-center justify-between border-b border-line bg-surface-header px-2.5 select-none">
              <div className="flex items-center gap-2">
                <img
                  src="./audify-icon.png"
                  alt=""
                  aria-hidden="true"
                  className="h-4 w-4 rounded-[3px] object-contain"
                />
                <span className="text-[12px] font-semibold text-fg">Audify</span>
                <button
                  type="button"
                  title="Toggle sidebar panel"
                  onClick={() => setSidebarOpen((v) => !v)}
                  className={`flex h-5 w-5 items-center justify-center rounded-[3px] border transition-colors ${
                    sidebarOpen
                      ? "border-accent bg-accent-soft text-accent-fg"
                      : "border-line bg-surface-2 text-fg-3 hover:text-fg"
                  }`}
                >
                  <PanelLeft className="h-3 w-3" />
                </button>
              </div>

              <div className="flex items-center gap-2.5">
                <span className="font-mono text-[11px] text-fg-3">
                  {visibleSamples.length} samples
                </span>

                {/* Pixel-crisp Audify Window Caption Controls */}
                <div className="hidden items-center gap-1.5 pl-1 text-fg-3 sm:flex" aria-hidden="true">
                  <svg viewBox="0 0 11 11" className="h-2.5 w-2.5" shapeRendering="crispEdges">
                    <line x1="1" y1="6" x2="10" y2="6" stroke="currentColor" strokeWidth="1" />
                  </svg>
                  <svg viewBox="0 0 11 11" className="h-2.5 w-2.5" shapeRendering="crispEdges">
                    <rect x="1.5" y="1.5" width="8" height="8" fill="none" stroke="currentColor" strokeWidth="1" />
                  </svg>
                  <svg viewBox="0 0 11 11" className="h-2.5 w-2.5" shapeRendering="crispEdges">
                    <line x1="1.5" y1="1.5" x2="9.5" y2="9.5" stroke="currentColor" strokeWidth="1" />
                    <line x1="9.5" y1="1.5" x2="1.5" y2="9.5" stroke="currentColor" strokeWidth="1" />
                  </svg>
                </div>
              </div>
            </div>

            {/* 2. Authentic Audify Top Transport + Waveform Deck */}
            <div className="grid grid-cols-1 border-b border-line bg-surface-1 lg:grid-cols-[276px_minmax(0,1fr)]">
              {/* Left Transport Controls */}
              <div className="flex flex-col justify-between gap-2 border-b border-line p-2.5 lg:border-b-0 lg:border-r">
                <div className="flex items-center justify-between gap-1.5">
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      title="Previous sample"
                      onClick={() => handleStepSample(-1)}
                      className="flex h-7 w-7 items-center justify-center rounded-[3px] border border-line bg-surface-2 text-fg-2 hover:text-fg"
                    >
                      <SkipBack className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      title="Play / Pause (Space)"
                      onClick={handleTogglePlay}
                      className={`flex h-7 w-9 items-center justify-center rounded-[3px] border transition-colors ${
                        snap.isPlaying && snap.sampleId === selectedSample.id
                          ? "border-accent bg-accent text-accent-on"
                          : "border-line-strong bg-surface-3 text-fg hover:border-accent"
                      }`}
                    >
                      {snap.isPlaying && snap.sampleId === selectedSample.id ? (
                        <Pause className="h-3.5 w-3.5" />
                      ) : (
                        <Play className="h-3.5 w-3.5" />
                      )}
                    </button>
                    <button
                      type="button"
                      title="Next sample"
                      onClick={() => handleStepSample(1)}
                      className="flex h-7 w-7 items-center justify-center rounded-[3px] border border-line bg-surface-2 text-fg-2 hover:text-fg"
                    >
                      <SkipForward className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      title="Stop"
                      onClick={() => demoAudioEngine.stop()}
                      className="flex h-7 w-7 items-center justify-center rounded-[3px] border border-line bg-surface-2 text-fg-2 hover:text-fg"
                    >
                      <Square className="h-2.5 w-2.5" />
                    </button>
                  </div>

                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      title="Loop playback"
                      aria-pressed={loop}
                      onClick={() => {
                        const next = !loop;
                        setLoop(next);
                        demoAudioEngine.setLoop(next);
                      }}
                      className={`flex h-7 w-7 items-center justify-center rounded-[3px] border transition-colors ${
                        loop
                          ? "border-accent bg-accent-soft text-accent-fg"
                          : "border-line bg-surface-2 text-fg-3 hover:text-fg"
                      }`}
                    >
                      <Repeat className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      title="Autoplay on row click"
                      aria-pressed={autoplay}
                      onClick={() => setAutoplay((v) => !v)}
                      className={`flex h-7 w-7 items-center justify-center rounded-[3px] border transition-colors ${
                        autoplay
                          ? "border-accent bg-accent-soft text-accent-fg"
                          : "border-line bg-surface-2 text-fg-3 hover:text-fg"
                      }`}
                    >
                      <Zap className="h-3 w-3" />
                    </button>
                  </div>
                </div>

                {/* Timecode + FULL/SLICE status */}
                <div className="flex items-center justify-between font-mono text-[11px]">
                  <div>
                    <span className="text-accent-fg">{formatTime(activeTime)}</span>
                    <span className="text-fg-faint"> / </span>
                    <span className="text-fg-3">{formatTime(activeDur)}</span>
                  </div>
                  {hasSlice ? (
                    <button
                      type="button"
                      title={messages.demo.clearSlice}
                      onClick={() => {
                        setSlice({ start: 0, end: 1 });
                        demoAudioEngine.setSlice(0, 1);
                      }}
                      className="inline-flex items-center gap-1 rounded-[3px] border border-accent bg-accent-soft px-1.5 py-0.5 text-[9.5px] font-semibold text-accent-fg"
                    >
                      <span>
                        {messages.demo.sliceActive} ({((slice.end - slice.start) * activeDur).toFixed(2)}s)
                      </span>
                      <X className="h-2.5 w-2.5" />
                    </button>
                  ) : (
                    <span className="rounded-[3px] border border-line bg-surface-badge px-1.5 py-0.5 text-[9.5px] font-medium text-fg-2">
                      {messages.demo.fullMode}
                    </span>
                  )}
                </div>

                {/* Volume Slider + Live Semitone Pitch Stepper */}
                <div className="flex items-center justify-between gap-2">
                  <div className="flex flex-1 items-center gap-1.5">
                    <Volume2 className="h-3 w-3 shrink-0 text-fg-3" />
                    <input
                      type="range"
                      aria-label="Volume"
                      min={0}
                      max={1}
                      step={0.01}
                      value={volume}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        setVolume(v);
                        demoAudioEngine.setVolume(v);
                      }}
                      className="studio-slider w-full"
                    />
                    <span className="w-11 text-right font-mono text-[10px] text-fg-3">
                      {dbReadout}
                    </span>
                  </div>

                  {/* - 0st + */}
                  <div className="flex items-center rounded-[3px] border border-line bg-surface-2">
                    <button
                      type="button"
                      title="Pitch -1 semitone"
                      onClick={() => {
                        const next = Math.max(-12, pitch - 1);
                        setPitch(next);
                        demoAudioEngine.setPitch(next);
                      }}
                      className="flex h-5 w-5 items-center justify-center text-fg-3 hover:text-fg"
                    >
                      <Minus className="h-2.5 w-2.5" />
                    </button>
                    <button
                      type="button"
                      title="Reset pitch to 0st"
                      onClick={() => {
                        setPitch(0);
                        demoAudioEngine.setPitch(0);
                      }}
                      className={`min-w-[34px] px-1 font-mono text-[10px] ${
                        pitch !== 0 ? "text-accent-fg font-semibold" : "text-fg-2"
                      }`}
                    >
                      {pitch > 0 ? `+${pitch}st` : `${pitch}st`}
                    </button>
                    <button
                      type="button"
                      title="Pitch +1 semitone"
                      onClick={() => {
                        const next = Math.min(12, pitch + 1);
                        setPitch(next);
                        demoAudioEngine.setPitch(next);
                      }}
                      className="flex h-5 w-5 items-center justify-center text-fg-3 hover:text-fg"
                    >
                      <Plus className="h-2.5 w-2.5" />
                    </button>
                  </div>
                </div>
              </div>

              {/* Right Waveform Deck */}
              <div className="flex flex-col">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line-subtle bg-surface-1 px-2.5 py-1 text-[11px]">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate font-semibold text-fg">{selectedSample.fileName}</span>
                    <span className="hidden truncate font-mono text-[10px] text-fg-3 sm:inline">
                      {selectedSample.folder}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 font-mono text-[10px] text-fg-3">
                    <span className="hidden md:inline">{messages.demo.sliceHint}</span>
                    <span className="text-fg-2">
                      {(selectedSample.sampleRate / 1000).toFixed(1)} kHz /{" "}
                      {selectedSample.bitDepth > 0 ? `${selectedSample.bitDepth}-bit` : selectedSample.format} /{" "}
                      {selectedSample.channels === 1 ? "MONO" : "STEREO"}
                    </span>
                  </div>
                </div>

                <DeckWaveformCanvas
                  peaks={selectedSample.peaks}
                  duration={activeDur}
                  currentTime={activeTime}
                  isPlaying={snap.isPlaying && snap.sampleId === selectedSample.id}
                  sliceStart={slice.start}
                  sliceEnd={slice.end}
                  onSeek={(ratio) => playSample(selectedSample, ratio)}
                  onSliceChange={(s, e) => {
                    const next = { start: s, end: e };
                    setSlice(next);
                    demoAudioEngine.setSlice(s, e);
                  }}
                />
              </div>
            </div>

            {/* 3. Authentic Audify Search + Quick Tag Cloud Strip */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-surface-1 px-2.5 py-1.5">
              <div className="flex items-center gap-1.5">
                <div className="relative flex items-center">
                  <Search className="pointer-events-none absolute left-2 h-3.5 w-3.5 text-fg-3" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder={messages.demo.searchPlaceholder}
                    className="h-7 w-52 rounded-[4px] border border-line bg-surface-3 pl-7 pr-6 text-[11px] text-fg placeholder:text-fg-3 focus:border-accent sm:w-64"
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      aria-label="Clear search"
                      onClick={() => setSearchQuery("")}
                      className="absolute right-1.5 text-fg-3 hover:text-fg"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </div>

                {/* AI Similarity trigger button */}
                <button
                  type="button"
                  title="Find acoustically similar to active sample (Shift+Enter)"
                  onClick={() =>
                    setSimilarityAnchorId((prev) =>
                      prev === selectedSample.id ? null : selectedSample.id
                    )
                  }
                  className={`inline-flex h-7 items-center gap-1 rounded-[4px] border px-2 font-mono text-[10px] transition-colors ${
                    similarityAnchor
                      ? "border-accent bg-accent-soft text-accent-fg"
                      : "border-line bg-surface-2 text-fg-2 hover:border-line-hover hover:text-fg"
                  }`}
                >
                  <Sparkles className="h-3 w-3" />
                  <span>{messages.demo.similarityMode}</span>
                </button>
              </div>

              {/* Quick Tag Cloud with uniform rounded-[2px] swatches */}
              <div className="flex flex-wrap items-center gap-1">
                <Hash className="mr-0.5 h-3 w-3 text-fg-faint" />
                {QUICK_TAGS.map((tag) => {
                  const active = activeTag === tag;
                  return (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => setActiveTag((prev) => (prev === tag ? null : tag))}
                      className={`inline-flex items-center gap-1.5 rounded-[3px] border px-2 py-0.5 text-[10.5px] transition-colors ${
                        active
                          ? "border-accent bg-accent-soft text-accent-fg"
                          : "border-line bg-surface-badge text-fg-2 hover:border-line-hover hover:text-fg"
                      }`}
                    >
                      <span
                        className="h-2 w-2 rounded-[2px]"
                        style={{ backgroundColor: TAG_COLORS[tag] ?? "#F59E0B" }}
                      />
                      <span>{tag}</span>
                      <span className="font-mono text-[9.5px] text-fg-3">
                        {tagCounts[tag] ?? 0}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Active AI Similarity Banner (matches Tools Menu.png) */}
            {similarityAnchor && (
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-accent-soft px-3 py-1.5 text-[11px]">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-3.5 w-3.5 text-accent-fg" />
                  <span className="font-semibold text-accent-fg">
                    {messages.demo.similarityBanner}
                  </span>
                  <span className="text-fg-2">
                    Anchor: <strong className="font-mono text-fg">{similarityAnchor.fileName}</strong>
                  </span>
                  <span className="rounded-[3px] border border-accent/40 bg-surface-0 px-1.5 py-0.5 font-mono text-[10px] text-accent-fg">
                    {visibleSamples.length} matches · 0.2 ms
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setSimilarityAnchorId(null)}
                  className="inline-flex items-center gap-1 rounded-[3px] border border-line bg-surface-1 px-2 py-0.5 font-mono text-[10px] text-fg-2 hover:text-fg"
                >
                  <X className="h-3 w-3" />
                  <span>{messages.demo.clearSimilarity}</span>
                </button>
              </div>
            )}

            {/* 4. Main Workspace: Fixed height so switching filters NEVER resizes the frame */}
            <div className="flex h-[438px]">
              {/* Left Vertical Icon Rail (exact Audify surface-rail) */}
              <div className="flex w-10 shrink-0 flex-col items-center justify-between border-r border-line bg-surface-rail py-2">
                <div className="flex flex-col items-center gap-1.5">
                  <button
                    type="button"
                    title={messages.demo.allFiles}
                    onClick={() => setViewFilter("all")}
                    className={`flex h-7 w-7 items-center justify-center rounded-[4px] ${
                      viewFilter === "all"
                        ? "bg-accent-soft text-accent-fg"
                        : "text-fg-3 hover:bg-surface-hover hover:text-fg"
                    }`}
                  >
                    <Folder className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    title={`${messages.demo.favorites} (${favoriteCount})`}
                    onClick={() => setViewFilter((v) => (v === "favorites" ? "all" : "favorites"))}
                    className={`flex h-7 w-7 items-center justify-center rounded-[4px] ${
                      viewFilter === "favorites"
                        ? "bg-accent-soft text-accent-fg"
                        : "text-fg-3 hover:bg-surface-hover hover:text-fg"
                    }`}
                  >
                    <Star className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    title="Filter Music"
                    onClick={() => setActiveTag((t) => (t === "Music" ? null : "Music"))}
                    className={`flex h-7 w-7 items-center justify-center rounded-[4px] ${
                      activeTag === "Music"
                        ? "bg-accent-soft text-accent-fg"
                        : "text-fg-3 hover:bg-surface-hover hover:text-fg"
                    }`}
                  >
                    <Music className="h-3.5 w-3.5" />
                  </button>
                </div>
                <SlidersHorizontal className="h-3.5 w-3.5 text-fg-faint" />
              </div>

              {/* Optional Collapsible Left Library Views Sidebar */}
              {sidebarOpen && (
                <aside className="hidden w-48 shrink-0 flex-col border-r border-line bg-surface-1 p-2.5 text-[11px] md:flex">
                  <div className="mb-1.5 font-mono text-[9.5px] uppercase tracking-wider text-fg-head">
                    Library Views
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setViewFilter("all");
                      setActiveTag(null);
                    }}
                    className={`flex items-center justify-between rounded-[3px] px-2 py-1 text-left ${
                      viewFilter === "all" && !activeTag
                        ? "bg-accent-soft text-accent-fg"
                        : "text-fg-2 hover:bg-surface-hover"
                    }`}
                  >
                    <span>{messages.demo.allFiles}</span>
                    <span className="font-mono text-[10px] text-fg-3">{SAMPLES.length}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewFilter("favorites")}
                    className={`mt-0.5 flex items-center justify-between rounded-[3px] px-2 py-1 text-left ${
                      viewFilter === "favorites"
                        ? "bg-accent-soft text-accent-fg"
                        : "text-fg-2 hover:bg-surface-hover"
                    }`}
                  >
                    <span>{messages.demo.favorites}</span>
                    <span className="font-mono text-[10px] text-fg-3">{favoriteCount}</span>
                  </button>

                  <div className="mb-1.5 mt-4 font-mono text-[9.5px] uppercase tracking-wider text-fg-head">
                    Folders (3)
                  </div>
                  {["sfx", "ambience", "music"].map((folder) => {
                    const count = SAMPLES.filter((s) => s.folder.endsWith(folder)).length;
                    return (
                      <button
                        key={folder}
                        type="button"
                        onClick={() => setSearchQuery(folder === "sfx" ? "" : folder)}
                        className="flex items-center justify-between rounded-[3px] px-2 py-1 text-left text-fg-2 hover:bg-surface-hover"
                      >
                        <span className="inline-flex items-center gap-1.5">
                          <Folder className="h-3 w-3 text-fg-3" />
                          <span>{folder}</span>
                        </span>
                        <span className="font-mono text-[10px] text-fg-3">{count}</span>
                      </button>
                    );
                  })}
                </aside>
              )}

              {/* Virtualized-style High-Density 34px Sample Table */}
              <div className="min-w-0 flex-1 overflow-auto bg-surface-0">
                <table className="w-full min-w-[680px] border-collapse text-left">
                  <thead>
                    <tr className="h-7 border-b border-line bg-surface-header font-mono text-[9.5px] uppercase tracking-wider text-fg-head">
                      <th className="w-8 px-2 text-center">
                        <Star className="mx-auto h-3 w-3 text-fg-faint" />
                      </th>
                      <th className="w-16 px-2">{messages.demo.columns.class}</th>
                      <th className="px-2">{messages.demo.columns.fileName}</th>
                      <th className="w-[196px] px-2">{messages.demo.columns.waveform}</th>
                      <th className="w-28 px-2">{messages.demo.columns.genre}</th>
                      <th className="px-2">{messages.demo.columns.tags}</th>
                      <th className="w-20 px-3 text-right">{messages.demo.columns.time}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleSamples.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="py-12 text-center text-[12px] text-fg-3">
                          <p>{messages.demo.noMatches}</p>
                          <button
                            type="button"
                            onClick={() => {
                              setSearchQuery("");
                              setActiveTag(null);
                              setViewFilter("all");
                              setSimilarityAnchorId(null);
                            }}
                            className="mt-2 rounded-[3px] border border-accent bg-accent-soft px-3 py-1 font-mono text-[11px] text-accent-fg"
                          >
                            {messages.demo.resetFilters}
                          </button>
                        </td>
                      </tr>
                    ) : (
                      visibleSamples.map((sample) => {
                        const isSelected = sample.id === selectedSample.id;
                        const isRowPlaying = snap.isPlaying && snap.sampleId === sample.id;
                        const rowProgress =
                          snap.sampleId === sample.id && sample.duration > 0
                            ? snap.currentTime / sample.duration
                            : 0;
                        const simScore = similarityAnchor
                          ? computeSimilarityScore(similarityAnchor, sample)
                          : null;

                        return (
                          <tr
                            key={sample.id}
                            onClick={() => handleSelectRow(sample)}
                            className={`h-[34px] cursor-pointer border-b border-line-subtle text-[11.5px] transition-colors duration-75 ${
                              isSelected
                                ? "bg-accent-soft"
                                : "hover:bg-surface-hover"
                            }`}
                          >
                            {/* Star */}
                            <td className="px-2 text-center">
                              <button
                                type="button"
                                aria-label={`Favorite ${sample.fileName}`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setStarredIds((prev) => ({
                                    ...prev,
                                    [sample.id]: !prev[sample.id],
                                  }));
                                }}
                                className="inline-flex items-center justify-center"
                              >
                                <Star
                                  className={`h-3.5 w-3.5 ${
                                    starredIds[sample.id]
                                      ? "fill-accent text-accent"
                                      : "text-fg-faint hover:text-fg-2"
                                  }`}
                                />
                              </button>
                            </td>

                            {/* Class arrow / Similarity Score */}
                            <td className="px-2">
                              {simScore !== null ? (
                                simScore === 100 ? (
                                  <span className="inline-block rounded-[2px] border border-accent bg-accent px-1.5 py-0.5 font-mono text-[9px] font-semibold text-accent-on">
                                    {messages.demo.anchorBadge}
                                  </span>
                                ) : (
                                  <span className="inline-block rounded-[2px] border border-accent/40 bg-surface-badge px-1.5 py-0.5 font-mono text-[9.5px] font-medium text-accent-fg">
                                    {simScore}%
                                  </span>
                                )
                              ) : (
                                <span
                                  className={`inline-flex h-5 w-7 items-center justify-center rounded-[3px] border text-[10px] ${
                                    isRowPlaying
                                      ? "border-accent bg-accent text-accent-on"
                                      : "border-line bg-surface-2 text-fg-3"
                                  }`}
                                >
                                  {isRowPlaying ? (
                                    <Volume2 className="h-3 w-3" />
                                  ) : (
                                    <ArrowRight className="h-3 w-3" />
                                  )}
                                </span>
                              )}
                            </td>

                            {/* File Name */}
                            <td className="max-w-[230px] truncate px-2 font-medium text-fg">
                              <span className={isSelected ? "text-accent-fg" : "text-fg"}>
                                {sample.fileName.replace(/\.[^.]+$/, "")}
                              </span>
                              <span className="font-mono text-[10px] text-fg-3">
                                .{sample.format.toLowerCase()}
                              </span>
                            </td>

                            {/* Real Mini Waveform */}
                            <td className="px-2">
                              <MiniWaveformCanvas
                                peaks={sample.peaks}
                                isActive={isSelected}
                                progressRatio={rowProgress}
                                width={180}
                                height={22}
                              />
                            </td>

                            {/* Genre Pill */}
                            <td className="px-2">
                              <span className="inline-block rounded-[3px] border border-line bg-surface-badge px-1.5 py-0.5 text-[10px] text-fg-2">
                                {sample.genre}
                              </span>
                            </td>

                            {/* Tags with uniform rounded-[2px] color swatches */}
                            <td className="px-2">
                              <div className="flex items-center gap-1">
                                {sample.tags.map((tag) => (
                                  <span
                                    key={tag}
                                    className="inline-flex items-center gap-1 rounded-[3px] border border-line bg-surface-badge px-1.5 py-0.5 text-[10px] text-fg-2"
                                  >
                                    <span
                                      className="h-1.5 w-1.5 rounded-[2px]"
                                      style={{ backgroundColor: TAG_COLORS[tag] ?? "#F59E0B" }}
                                    />
                                    <span>{tag}</span>
                                  </span>
                                ))}
                              </div>
                            </td>

                            {/* Duration */}
                            <td className="px-3 text-right font-mono text-[11px] text-fg-2">
                              {formatTime(sample.duration)}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* 5. Authentic Audify Bottom Status Bar */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line bg-surface-1 px-3 py-1 font-mono text-[10px] text-fg-3">
              <span>{messages.demo.statusReady}</span>
              <div className="flex items-center gap-3">
                <span>{selectedSample.lufs.toFixed(1)} LUFS</span>
                <span>{formatSize(selectedSample.sizeBytes)}</span>
                <span className="inline-flex items-center gap-1 text-fg-2">
                  <Volume2 className="h-3 w-3 text-accent-fg" />
                  <span>Speakers (Web Audio)</span>
                </span>
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
};
