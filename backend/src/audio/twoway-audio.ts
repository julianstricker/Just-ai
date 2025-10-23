import { PassThrough } from 'stream';
import { spawn } from 'node:child_process';
import ffmpegPath from 'ffmpeg-static';
import { CameraInfo } from '../storage/state.js';
import { logger } from '../config/logger.js';

/**
 * Placeholder implementation for two-way audio.
 * In production this module would open the ONVIF backchannel RTP stream
 * and pipe audio frames to and from the camera.
 */
export async function createAudioStream(camera: CameraInfo) {
  // Build candidate RTSP URLs for audio ingest
  const baseCandidates = [camera.rtspAudioUrl, camera.rtspUrl, `rtsp://${camera.host}/stream1`, `rtsp://${camera.host}/stream2`]
    .filter(Boolean) as string[];

  const encUser = camera.username ? encodeURIComponent(camera.username) : '';
  const encPass = camera.password ? encodeURIComponent(camera.password) : '';

  const withCreds = (u: string) => {
    if (!camera.username) return u;
    try {
      const url = new URL(u);
      const hostAndPath = `${url.host}${url.pathname}${url.search}`;
      return `rtsp://${encUser}:${encPass}@${hostAndPath}`;
    } catch {
      const prefix = 'rtsp://';
      const rest = u.startsWith(prefix) ? u.substring(prefix.length).replace(/^([^@]+)@/, '') : u;
      return `${prefix}${encUser}:${encPass}@${rest}`;
    }
  };

  const out = new PassThrough();
  if (!ffmpegPath) return out;

  // Try candidates and transports, only return after first audio byte received
  for (const cand of baseCandidates) {
    const url = withCreds(cand);
    for (const transport of ['tcp', 'udp'] as const) {
      logger.info('Starting audio ingest for %s via %s', camera.name, transport);
      const args = [
        '-loglevel', 'error',
        '-rtsp_transport', transport,
        '-i', url,
        '-map', '0:a:0?',
        '-vn',
        '-ac', '1',
        '-ar', '16000',
        '-acodec', 'pcm_s16le',
        '-f', 'wav',
        'pipe:1',
      ];
      const ff = spawn(ffmpegPath as string, args, { stdio: ['ignore', 'pipe', 'pipe'] });

      const gotData = await new Promise<boolean>((resolve) => {
        let resolved = false;
        const t = setTimeout(() => { if (!resolved) { resolved = true; resolve(false); } }, 1500);
        ff.stdout?.once('data', (d: Buffer) => {
          if (!resolved) {
            resolved = true;
            clearTimeout(t);
            // Pipe and continue streaming
            out.write(d);
            resolve(true);
          }
        });
        ff.on('error', () => { if (!resolved) { resolved = true; resolve(false); } });
        ff.on('close', () => { if (!resolved) { resolved = true; resolve(false); } });
      });

      if (gotData) {
        // Now pipe the rest and manage lifecycle
        ff.stdout?.pipe(out, { end: false });
        ff.stderr?.on('data', () => {});
        out.once('close', () => { try { ff.kill('SIGKILL'); } catch {} });
        return out;
      } else {
        try { ff.kill('SIGKILL'); } catch {}
        continue; // try next transport/candidate
      }
    }
  }

  return out;
}

export async function playAudioToCamera(camera: CameraInfo, audioBuffer: Buffer) {
  // Send PCM buffer to camera talkback via ffmpeg if talkRtspUrl provided
  if (!camera.talkRtspUrl || !ffmpegPath) return;
  const url = camera.talkRtspUrl;
  const ff = spawn(ffmpegPath as string, [
    '-f', 's16le', '-ac', '1', '-ar', '16000', '-i', 'pipe:0',
    '-acodec', 'aac',
    '-f', 'rtsp', '-rtsp_transport', 'tcp', url
  ], { stdio: ['pipe', 'ignore', 'ignore'] });
  ff.stdin?.end(audioBuffer);
}
