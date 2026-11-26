const AUDIO_FORMAT_VALUES = [
  { value: "wav", meta: "PCM WAV" },
  { value: "mp3", meta: "MP3" },
  { value: "flac", meta: "Lossless FLAC" },
  { value: "ogg", meta: "Ogg Vorbis" },
  { value: "opus", meta: "Opus Audio" },
  { value: "aiff", meta: "AIFF" },
  { value: "aif", meta: "AIFF (.aif)" },
  { value: "m4a", meta: "AAC / M4A" },
  { value: "aac", meta: "AAC Audio" },
] as const;

const SAMPLE_CLASS_VALUES = [
  { value: "loop", meta: "Loopable tracks" },
  { value: "oneshot", meta: "One-shot SFX / hits" },
  { value: "fav", meta: "Starred favorites" },
] as const;

export const STATIC_OPERATOR_OPTIONS: Record<
  string,
  { header: string; values: ReadonlyArray<{ value: string; meta: string }> }
> = {
  ext: {
    header: "AUDIO FORMAT (ext:)",
    values: AUDIO_FORMAT_VALUES,
  },
  format: {
    header: "AUDIO FORMAT (format:)",
    values: AUDIO_FORMAT_VALUES,
  },
  type: {
    header: "SAMPLE TYPE (type:)",
    values: SAMPLE_CLASS_VALUES,
  },
  is: {
    header: "SAMPLE TYPE (is:)",
    values: SAMPLE_CLASS_VALUES,
  },
  channels: {
    header: "CHANNELS (channels:)",
    values: [
      { value: "mono", meta: "1ch Mono" },
      { value: "stereo", meta: "2ch Stereo" },
      { value: "multi", meta: "Surround / 3ch+" },
    ],
  },
  ch: {
    header: "CHANNELS (ch:)",
    values: [
      { value: "mono", meta: "1ch Mono" },
      { value: "stereo", meta: "2ch Stereo" },
      { value: "multi", meta: "Surround / 3ch+" },
    ],
  },
  sr: {
    header: "SAMPLE RATE (sr:)",
    values: [
      { value: "48k", meta: "48 kHz (Video/NLE)" },
      { value: "44.1k", meta: "44.1 kHz (CD/Music)" },
      { value: "96k", meta: "96 kHz (Hi-Res SFX)" },
      { value: ">=48k", meta: "48 kHz or higher" },
    ],
  },
  bit: {
    header: "BIT DEPTH (bit:)",
    values: [
      { value: "24", meta: "24-bit" },
      { value: "16", meta: "16-bit" },
      { value: "32", meta: "32-bit float" },
      { value: ">=24", meta: "24-bit or higher" },
    ],
  },
  dur: {
    header: "DURATION (dur:)",
    values: [
      { value: "<1s", meta: "One-shots (< 1s)" },
      { value: "<3s", meta: "Short SFX (< 3s)" },
      { value: "1-5s", meta: "1s to 5s" },
      { value: ">10s", meta: "Loops / Ambiences (> 10s)" },
    ],
  },
  size: {
    header: "FILE SIZE (size:)",
    values: [
      { value: "<500kb", meta: "Compact (< 500 KB)" },
      { value: "<2mb", meta: "Small (< 2 MB)" },
      { value: "1-10mb", meta: "1 MB to 10 MB" },
      { value: ">10mb", meta: "Large (> 10 MB)" },
    ],
  },
  bpm: {
    header: "TEMPO (bpm:)",
    values: [
      { value: "90", meta: "±2 BPM" },
      { value: "110", meta: "±2 BPM" },
      { value: "120", meta: "±2 BPM" },
      { value: "128", meta: "±2 BPM" },
      { value: "140", meta: "±2 BPM" },
      { value: "120-130", meta: "BPM range" },
    ],
  },
};
