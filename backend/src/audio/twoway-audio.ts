import { PassThrough } from 'stream';
import { spawn } from 'node:child_process';
import ffmpegPath from 'ffmpeg-static';
import { CameraInfo } from '../storage/state.js';

/**
 * Placeholder implementation for two-way audio.
 * In production this module would open the ONVIF backchannel RTP stream
 * and pipe audio frames to and from the camera.
 */
export async function createAudioStream(camera: CameraInfo) {
  const inputUrl = camera.rtspAudioUrl || camera.rtspUrl || `rtsp://${camera.host}/stream1`;
  let url = inputUrl;
  if (camera.username && !inputUrl.includes('@')) {
    try {
      const u = new URL(inputUrl);
      if (!u.username) {
        u.username = camera.username;
        u.password = camera.password ?? '';
        url = u.toString();
      }
    } catch {
      const prefix = 'rtsp://';
      if (inputUrl.startsWith(prefix)) {
        const rest = inputUrl.substring(prefix.length);
        url = `${prefix}${encodeURIComponent(camera.username)}:${encodeURIComponent(camera.password ?? '')}@${rest}`;
      }
    }
  }

  const out = new PassThrough();
  if (!ffmpegPath) return out;

  const args = [
    '-rtsp_transport', 'tcp',
    '-i', url,
    '-vn',
    '-ac', '1',
    '-ar', '16000',
    '-f', 'wav', // containerize as WAV for transcription compatibility
    'pipe:1',
  ];
  const ff = spawn(ffmpegPath as string, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  ff.stdout?.pipe(out);
  ff.stderr?.on('data', () => {});
  out.on('close', () => { try { ff.kill('SIGKILL'); } catch {} });
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
