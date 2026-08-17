/**
 * Convert Piper WAV (or other) buffers to WhatsApp-friendly / requested formats via ffmpeg.
 */
import { spawn } from 'child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const FORMAT_EXT = {
  wav: 'wav',
  mp3: 'mp3',
  m4a: 'm4a',
  aac: 'm4a',
  ogg: 'ogg',
  opus: 'ogg',
};

const FORMAT_MIME = {
  wav: 'audio/wav',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  aac: 'audio/mp4',
  // WhatsApp PTT (OpenClaw always sends audio/* as ptt:true) needs the codec parameter.
  ogg: 'audio/ogg; codecs=opus',
  opus: 'audio/ogg; codecs=opus',
};

/** FFmpeg args after `-i <in>` for WhatsApp voice notes (48 kHz mono Opus in OGG). */
export const WHATSAPP_OPUS_FFMPEG_ARGS = [
  '-vn',
  '-ac',
  '1',
  '-ar',
  '48000',
  '-c:a',
  'libopus',
  '-b:a',
  '32k',
  '-vbr',
  'on',
  '-application',
  'voip',
  '-avoid_negative_ts',
  'make_zero',
  '-map_metadata',
  '-1',
  '-f',
  'ogg',
];

export function normalizeAudioFormat(raw) {
  const f = String(raw || 'wav').trim().toLowerCase().replace(/^\./, '');
  if (f === 'mpeg') return 'mp3';
  if (FORMAT_EXT[f]) return f;
  return 'wav';
}

export function audioMimeForFormat(format) {
  return FORMAT_MIME[normalizeAudioFormat(format)] || 'audio/wav';
}

export function audioExtensionForFormat(format) {
  return FORMAT_EXT[normalizeAudioFormat(format)] || 'wav';
}

function ffmpegBin() {
  return String(process.env.FFMPEG_PATH || 'ffmpeg').trim() || 'ffmpeg';
}

function runFfmpeg(args, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegBin(), args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    const t = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch (_) {}
      reject(new Error('ffmpeg timeout'));
    }, timeoutMs);
    child.stderr.on('data', (d) => {
      stderr += String(d);
    });
    child.on('error', (e) => {
      clearTimeout(t);
      reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(t);
      if (code === 0) resolve({ ok: true });
      else reject(new Error(`ffmpeg exit ${code}: ${stderr.slice(-400)}`));
    });
  });
}

/**
 * @param {Buffer} inputBuffer
 * @param {string} targetFormat wav|mp3|m4a|ogg|opus
 * @param {{ inputExt?: string }} [opts]
 * @returns {Promise<{ buffer: Buffer, format: string, mime: string, ext: string }>}
 */
export async function convertAudioBuffer(inputBuffer, targetFormat = 'wav', opts = {}) {
  const format = normalizeAudioFormat(targetFormat);
  const inExt = String(opts.inputExt || 'wav').replace(/^\./, '') || 'wav';
  if (!Buffer.isBuffer(inputBuffer) || !inputBuffer.length) {
    throw new Error('audio buffer required');
  }
  // Already wav and requesting wav ? no-op.
  if (format === 'wav' && inExt === 'wav') {
    return { buffer: inputBuffer, format: 'wav', mime: 'audio/wav', ext: 'wav' };
  }

  const dir = mkdtempSync(join(tmpdir(), 'aos-audio-'));
  const inPath = join(dir, `in.${inExt}`);
  const outExt = audioExtensionForFormat(format);
  const outPath = join(dir, `out.${outExt}`);
  writeFileSync(inPath, inputBuffer);

  const args = ['-y', '-i', inPath];
  if (format === 'mp3') {
    args.push('-codec:a', 'libmp3lame', '-b:a', '128k');
  } else if (format === 'm4a' || format === 'aac') {
    args.push('-codec:a', 'aac', '-b:a', '128k');
  } else if (format === 'ogg' || format === 'opus') {
    args.push(...WHATSAPP_OPUS_FFMPEG_ARGS);
  } else {
    // Whisper-friendly mono 16 kHz PCM
    args.push('-vn', '-ac', '1', '-ar', '16000', '-codec:a', 'pcm_s16le');
  }
  args.push(outPath);

  try {
    await runFfmpeg(args);
    if (!existsSync(outPath)) throw new Error('ffmpeg produced no output');
    const buffer = readFileSync(outPath);
    return {
      buffer,
      format,
      mime: audioMimeForFormat(format),
      ext: outExt,
    };
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch (_) {}
  }
}

/**
 * Prefer WhatsApp-safe OGG/Opus for channel MEDIA: attach.
 * Do not fall back to MP3: OpenClaw WhatsApp sends every audio/* as a PTT voice note,
 * and MP3/WAV PTT shows "Media error" on the phone.
 */
export async function toWhatsAppSafeAudio(inputBuffer, inputExt = 'wav') {
  return convertAudioBuffer(inputBuffer, 'ogg', { inputExt });
}

/**
 * Extract a Whisper-friendly WAV track from audio or video containers.
 * @param {Buffer} inputBuffer
 * @param {string} [inputExt]
 */
export async function extractAudioTrackForStt(inputBuffer, inputExt = 'bin') {
  const ext = String(inputExt || 'bin').replace(/^\./, '').toLowerCase() || 'bin';
  const audioLike = new Set(['wav', 'mp3', 'm4a', 'aac', 'ogg', 'opus', 'webm', 'flac']);
  if (ext === 'wav') {
    return { buffer: inputBuffer, format: 'wav', mime: 'audio/wav', ext: 'wav' };
  }
  if (audioLike.has(ext)) {
    return convertAudioBuffer(inputBuffer, 'wav', { inputExt: ext });
  }
  // Video (mp4/mov/mkv/…) — demux/re-encode audio only
  return convertAudioBuffer(inputBuffer, 'wav', { inputExt: ext });
}
