import { registerAudioSpectrumReader } from "./demoAudioBridge";

export interface PlaybackSnapshot {
  isPlaying: boolean;
  sampleId: string | null;
  currentTime: number;
  duration: number;
}

type Listener = (snap: PlaybackSnapshot) => void;

/**
 * Self-contained Web Audio API engine for the 1:1 Audify Live Demo.
 * Decodes real CC0 audio buffers on demand, caches them for 0ms repeat audition,
 * and supports live semitone pitch shifting, volume dB control, looping, and slice regions.
 */
class DemoAudioEngine {
  private ctx: AudioContext | null = null;
  private gainNode: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private freqBytes: Uint8Array<ArrayBuffer> | null = null;
  private spectrumOut: Float32Array = new Float32Array(32);

  private bufferCache = new Map<string, AudioBuffer>();
  private source: AudioBufferSourceNode | null = null;

  private activeSampleId: string | null = null;
  private activeBuffer: AudioBuffer | null = null;
  private startedAtCtx = 0;
  private startOffsetSec = 0;
  private regionEndSec = 0;
  private isPlaying = false;

  private volumeLinear = 0.85;
  private pitchSemitones = 0;
  private loop = false;
  private sliceStartRatio = 0;
  private sliceEndRatio = 1;

  private rafId = 0;
  private listeners = new Set<Listener>();

  private ensureContext(): AudioContext {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioCtx();
      this.gainNode = this.ctx.createGain();
      this.gainNode.gain.value = this.volumeLinear;

      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 128;
      this.analyser.smoothingTimeConstant = 0.78;
      this.freqBytes = new Uint8Array(this.analyser.frequencyBinCount);

      this.gainNode.connect(this.analyser);
      this.analyser.connect(this.ctx.destination);

      registerAudioSpectrumReader(() => {
        if (!this.isPlaying || !this.analyser || !this.freqBytes) return null;
        this.analyser.getByteFrequencyData(this.freqBytes);
        for (let i = 0; i < this.spectrumOut.length; i++) {
          this.spectrumOut[i] = (this.freqBytes[i] ?? 0) / 255;
        }
        return this.spectrumOut;
      });
    }
    if (this.ctx.state === "suspended") {
      void this.ctx.resume();
    }
    return this.ctx;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.getSnapshot());
    return () => {
      this.listeners.delete(fn);
    };
  }

  private emit(): void {
    const snap = this.getSnapshot();
    this.listeners.forEach((fn) => fn(snap));
  }

  private getPlaybackRate(): number {
    return Math.pow(2, this.pitchSemitones / 12);
  }

  getSnapshot(): PlaybackSnapshot {
    const duration = this.activeBuffer?.duration ?? 0;
    let currentTime = this.startOffsetSec;

    if (this.isPlaying && this.ctx && this.activeBuffer) {
      const elapsed = (this.ctx.currentTime - this.startedAtCtx) * this.getPlaybackRate();
      const regionStart = this.sliceStartRatio * duration;
      const regionEnd = Math.max(regionStart + 0.02, this.sliceEndRatio * duration);
      const regionLen = regionEnd - regionStart;

      if (this.loop && regionLen > 0.02) {
        const posInRegion = ((this.startOffsetSec - regionStart) + elapsed) % regionLen;
        currentTime = regionStart + (posInRegion < 0 ? posInRegion + regionLen : posInRegion);
      } else {
        currentTime = Math.min(regionEnd, this.startOffsetSec + elapsed);
      }
    }

    return {
      isPlaying: this.isPlaying,
      sampleId: this.activeSampleId,
      currentTime,
      duration,
    };
  }

  private startTick(): void {
    window.cancelAnimationFrame(this.rafId);
    const tick = () => {
      if (!this.isPlaying) return;
      this.emit();
      this.rafId = window.requestAnimationFrame(tick);
    };
    this.rafId = window.requestAnimationFrame(tick);
  }

  private stopSourceOnly(): void {
    if (this.source) {
      try {
        this.source.onended = null;
        this.source.stop();
        this.source.disconnect();
      } catch {
        // Already stopped
      }
      this.source = null;
    }
    window.cancelAnimationFrame(this.rafId);
  }

  async loadBuffer(sampleId: string, src: string): Promise<AudioBuffer> {
    const cached = this.bufferCache.get(sampleId);
    if (cached) return cached;

    const ctx = this.ensureContext();
    const res = await fetch(src);
    const arr = await res.arrayBuffer();
    const decoded = await ctx.decodeAudioData(arr);
    this.bufferCache.set(sampleId, decoded);
    return decoded;
  }

  async play(
    sampleId: string,
    src: string,
    options?: {
      startRatio?: number;
      sliceStart?: number;
      sliceEnd?: number;
      pitchSemitones?: number;
      loop?: boolean;
      volumeLinear?: number;
    }
  ): Promise<void> {
    const ctx = this.ensureContext();
    if (options?.pitchSemitones !== undefined) this.pitchSemitones = options.pitchSemitones;
    if (options?.loop !== undefined) this.loop = options.loop;
    if (options?.volumeLinear !== undefined) {
      this.volumeLinear = options.volumeLinear;
      if (this.gainNode) this.gainNode.gain.value = this.volumeLinear;
    }
    if (options?.sliceStart !== undefined) this.sliceStartRatio = options.sliceStart;
    if (options?.sliceEnd !== undefined) this.sliceEndRatio = options.sliceEnd;

    const buffer = await this.loadBuffer(sampleId, src);
    this.stopSourceOnly();

    this.activeSampleId = sampleId;
    this.activeBuffer = buffer;

    const duration = buffer.duration;
    const regionStart = this.sliceStartRatio * duration;
    const regionEnd = Math.max(regionStart + 0.02, this.sliceEndRatio * duration);
    const startSec =
      options?.startRatio !== undefined
        ? Math.min(regionEnd - 0.01, Math.max(0, options.startRatio * duration))
        : regionStart;

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = this.getPlaybackRate();
    source.loop = this.loop;
    if (this.loop) {
      source.loopStart = regionStart;
      source.loopEnd = regionEnd;
    }

    if (this.gainNode) {
      source.connect(this.gainNode);
    }

    this.source = source;
    this.startedAtCtx = ctx.currentTime;
    this.startOffsetSec = startSec;
    this.regionEndSec = regionEnd;
    this.isPlaying = true;

    source.onended = () => {
      if (this.source === source && !this.loop) {
        this.isPlaying = false;
        this.startOffsetSec = regionStart;
        window.cancelAnimationFrame(this.rafId);
        this.emit();
      }
    };

    if (this.loop) {
      source.start(0, startSec);
    } else {
      const playDur = Math.max(0.02, regionEnd - startSec);
      source.start(0, startSec, playDur);
    }

    this.emit();
    this.startTick();
  }

  stop(): void {
    this.stopSourceOnly();
    this.isPlaying = false;
    this.startOffsetSec = this.activeBuffer ? this.sliceStartRatio * this.activeBuffer.duration : 0;
    this.emit();
  }

  pause(): void {
    if (!this.isPlaying) return;
    const snap = this.getSnapshot();
    this.stopSourceOnly();
    this.isPlaying = false;
    this.startOffsetSec = snap.currentTime;
    this.emit();
  }

  setVolume(linear: number): void {
    this.volumeLinear = Math.max(0, Math.min(1.25, linear));
    if (this.gainNode && this.ctx) {
      this.gainNode.gain.setTargetAtTime(this.volumeLinear, this.ctx.currentTime, 0.012);
    }
  }

  setPitch(semitones: number): void {
    const snap = this.getSnapshot();
    this.pitchSemitones = Math.max(-12, Math.min(12, semitones));
    if (this.source && this.ctx) {
      this.startOffsetSec = snap.currentTime;
      this.startedAtCtx = this.ctx.currentTime;
      this.source.playbackRate.setValueAtTime(this.getPlaybackRate(), this.ctx.currentTime);
    }
  }

  setLoop(loop: boolean): void {
    this.loop = loop;
    if (this.source && this.activeBuffer) {
      const dur = this.activeBuffer.duration;
      this.source.loop = loop;
      this.source.loopStart = this.sliceStartRatio * dur;
      this.source.loopEnd = Math.max(this.source.loopStart + 0.02, this.sliceEndRatio * dur);
    }
  }

  setSlice(startRatio: number, endRatio: number): void {
    this.sliceStartRatio = Math.max(0, Math.min(0.98, startRatio));
    this.sliceEndRatio = Math.max(this.sliceStartRatio + 0.02, Math.min(1, endRatio));
    if (this.source && this.activeBuffer && this.loop) {
      const dur = this.activeBuffer.duration;
      this.source.loopStart = this.sliceStartRatio * dur;
      this.source.loopEnd = this.sliceEndRatio * dur;
    }
    this.regionEndSec = this.activeBuffer ? this.sliceEndRatio * this.activeBuffer.duration : 0;
    void this.regionEndSec;
  }
}

export const demoAudioEngine = new DemoAudioEngine();
