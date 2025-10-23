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
  if (!ffmpegPath) {
    logger.warn('FFmpeg not available for audio streaming from %s', camera.name);
    return out;
  }

  // Try candidates and transports, only return after first audio byte received
  for (const cand of baseCandidates) {
    const url = withCreds(cand);
    for (const transport of ['tcp', 'udp'] as const) {
      logger.info('Starting audio ingest for %s via %s transport', camera.name, transport);
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
        '-reconnect', '1',
        '-reconnect_streamed', '1',
        '-reconnect_delay_max', '2',
        'pipe:1',
      ];
      const ff = spawn(ffmpegPath as string, args, { stdio: ['ignore', 'pipe', 'pipe'] });

      const gotData = await new Promise<boolean>((resolve) => {
        let resolved = false;
        const t = setTimeout(() => { 
          if (!resolved) { 
            resolved = true; 
            logger.warn('Audio stream timeout for %s via %s', camera.name, transport);
            resolve(false); 
          } 
        }, 2000);
        
        ff.stdout?.once('data', (d: Buffer) => {
          if (!resolved) {
            resolved = true;
            clearTimeout(t);
            logger.info('Audio stream established for %s via %s', camera.name, transport);
            // Pipe and continue streaming
            out.write(d);
            resolve(true);
          }
        });
        
        ff.on('error', (err) => { 
          if (!resolved) { 
            resolved = true; 
            logger.warn('FFmpeg error for %s: %s', camera.name, err.message);
            resolve(false); 
          } 
        });
        
        ff.on('close', (code) => { 
          if (!resolved) { 
            resolved = true; 
            logger.warn('FFmpeg closed for %s with code %d', camera.name, code);
            resolve(false); 
          } 
        });
      });

      if (gotData) {
        // Now pipe the rest and manage lifecycle
        ff.stdout?.pipe(out, { end: false });
        ff.stderr?.on('data', (data) => {
          // Log FFmpeg errors for debugging
          const message = data.toString();
          if (message.includes('error') || message.includes('Error')) {
            logger.warn('FFmpeg stderr for %s: %s', camera.name, message.trim());
          }
        });
        
        out.once('close', () => { 
          try { 
            ff.kill('SIGKILL'); 
          } catch (err) {
            logger.warn('Error killing FFmpeg process: %s', (err as Error).message);
          }
        });
        
        out.once('error', () => {
          try { 
            ff.kill('SIGKILL'); 
          } catch (err) {
            logger.warn('Error killing FFmpeg process on stream error: %s', (err as Error).message);
          }
        });
        
        return out;
      } else {
        try { 
          ff.kill('SIGKILL'); 
        } catch (err) {
          logger.warn('Error killing failed FFmpeg process: %s', (err as Error).message);
        }
        continue; // try next transport/candidate
      }
    }
  }

  logger.warn('No audio stream could be established for %s', camera.name);
  return out;
}

export async function playAudioToCamera(camera: CameraInfo, audioBuffer: Buffer) {
  // Send PCM buffer to camera talkback via ffmpeg if talkRtspUrl provided
  if (!camera.talkRtspUrl || !ffmpegPath) {
    logger.warn('Cannot play audio to %s: missing talkRtspUrl or ffmpeg', camera.name);
    return;
  }
  
  if (audioBuffer.length === 0) {
    logger.debug('Empty audio buffer for %s, skipping playback', camera.name);
    return;
  }
  
  const url = camera.talkRtspUrl;
  logger.debug('Playing %d bytes of audio to %s', audioBuffer.length, camera.name);
  
  const ff = spawn(ffmpegPath as string, [
    '-f', 's16le', '-ac', '1', '-ar', '16000', '-i', 'pipe:0',
    '-acodec', 'aac',
    '-b:a', '64k', // Lower bitrate for better compatibility
    '-f', 'rtsp', '-rtsp_transport', 'tcp', url
  ], { stdio: ['pipe', 'ignore', 'pipe'] });
  
  // Handle FFmpeg errors
  ff.stderr?.on('data', (data) => {
    const message = data.toString();
    if (message.includes('error') || message.includes('Error')) {
      logger.warn('FFmpeg playback error for %s: %s', camera.name, message.trim());
    }
  });
  
  ff.on('error', (err) => {
    logger.error('FFmpeg playback process error for %s: %s', camera.name, err.message);
  });
  
  ff.on('close', (code) => {
    if (code !== 0) {
      logger.warn('FFmpeg playback process closed with code %d for %s', code, camera.name);
    } else {
      logger.debug('Audio playback completed for %s', camera.name);
    }
  });
  
  try {
    ff.stdin?.end(audioBuffer);
  } catch (err) {
    logger.error('Error sending audio to FFmpeg for %s: %s', camera.name, (err as Error).message);
  }
}
