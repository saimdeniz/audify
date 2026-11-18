export const SUPPORTED_AUDIO_EXTENSIONS = [
  "wav",
  "mp3",
  "flac",
  "ogg",
  "aiff",
  "aif",
  "m4a",
  "opus",
  "aac",
] as const;

export const AUDIO_EXTENSION_RE = new RegExp(
  `\\.(${SUPPORTED_AUDIO_EXTENSIONS.join("|")})$`,
  "i"
);
