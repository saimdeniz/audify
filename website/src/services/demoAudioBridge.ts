/**
 * Lightweight zero-re-render bridge between the Live Demo Web Audio engine
 * and the redesigned ASCII Atmosphere canvas (Spectrum preset).
 */
type EnergyReader = () => Float32Array | null;

let activeReader: EnergyReader | null = null;

export function registerAudioSpectrumReader(reader: EnergyReader | null): void {
  activeReader = reader;
}

export function readLiveSpectrumBins(): Float32Array | null {
  return activeReader ? activeReader() : null;
}
