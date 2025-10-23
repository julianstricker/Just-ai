import { PassThrough } from 'stream';
import { spawn } from 'node:child_process';
import ffmpegPath from 'ffmpeg-static';
import { CameraInfo } from '../storage/state.js';
import { logger } from '../config/logger.js';

/**
 * Extract audio from camera video stream for wake word detection and voice input.
 * Audio is ALWAYS extracted from the video stream - no fallback to separate audio streams.
 */
export async function createAudioStream(camera: CameraInfo) {
  // Build candidate RTSP URLs - ONLY video streams, no separate audio streams
  const baseCandidates = [
    camera.rtspUrl, 
    `rtsp://${camera.host}/stream1`, 
    `rtsp://${camera.host}/stream2`,
    `rtsp://${camera.host}/live/main`,
    `rtsp://${camera.host}/live/sub`
  ].filter(Boolean) as string[];

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

  // Try candidates, transports, and audio mapping strategies
  for (const cand of baseCandidates) {
    const url = withCreds(cand);
    
    for (const transport of ['tcp', 'udp'] as const) {
      logger.info('Trying %s via %s transport', camera.name, transport);
      
      // Try different audio mapping strategies
      const audioMappingStrategies = [
        ['-map', '0:a:0'], // First audio track
        ['-map', '0:a'],   // Any audio track  
        ['-map', '0:1'],   // Second stream (often audio)
      ];

      for (const [mapFlag, mapValue] of audioMappingStrategies) {
        logger.debug('Trying audio mapping %s %s for %s', mapFlag, mapValue, camera.name);
        
        const args = [
          '-loglevel', 'info',
          '-rtsp_transport', transport,
          '-i', url,
          mapFlag, mapValue,
          '-vn',
          '-acodec', 'pcm_s16le',
          '-ac', '1',
          '-ar', '16000',
          '-f', 'wav',
          '-avoid_negative_ts', 'make_zero',
          '-fflags', '+genpts+igndts',
          '-reconnect', '1',
          '-reconnect_streamed', '1',
          '-reconnect_delay_max', '2',
          '-probesize', '32',
          '-analyzeduration', '0',
          'pipe:1',
        ];

        const ff = spawn(ffmpegPath as string, args, { stdio: ['ignore', 'pipe', 'pipe'] });

        const gotData = await new Promise<boolean>((resolve) => {
          let resolved = false;
          const timeout = setTimeout(() => { 
            if (!resolved) { 
              resolved = true; 
              logger.debug('Audio mapping %s %s timeout for %s', mapFlag, mapValue, camera.name);
              resolve(false); 
            } 
          }, 3000);
          
          ff.stdout?.once('data', (d: Buffer) => {
            if (!resolved) {
              resolved = true;
              clearTimeout(timeout);
              logger.info('Audio stream established for %s via %s with mapping %s %s', camera.name, transport, mapFlag, mapValue);
              out.write(d);
              resolve(true);
            }
          });
          
          ff.stderr?.on('data', (data) => {
            const message = data.toString().trim();
            if (message.includes('Stream #')) {
              logger.debug('FFmpeg stream info for %s: %s', camera.name, message);
            } else if (message.includes('Audio:')) {
              logger.info('FFmpeg audio detected for %s: %s', camera.name, message);
            } else if (message.includes('error') || message.includes('Error') || message.includes('Invalid')) {
              logger.debug('FFmpeg error for %s with %s %s: %s', camera.name, mapFlag, mapValue, message);
            }
          });
          
          ff.on('error', (err) => { 
            if (!resolved) { 
              resolved = true; 
              clearTimeout(timeout);
              logger.debug('FFmpeg process error for %s with %s %s: %s', camera.name, mapFlag, mapValue, err.message);
              resolve(false); 
            } 
          });
          
          ff.on('close', (code) => { 
            if (!resolved) { 
              resolved = true; 
              clearTimeout(timeout);
              if (code !== 0) {
                logger.debug('FFmpeg failed for %s with %s %s (code %d)', camera.name, mapFlag, mapValue, code);
              }
              resolve(false); 
            } 
          });
        });

        if (gotData) {
          // Success! Set up the stream
          ff.stdout?.pipe(out, { end: false });
          
          ff.stderr?.on('data', (data) => {
            const message = data.toString().trim();
            if (message.includes('error') || message.includes('Error')) {
              logger.warn('FFmpeg runtime error for %s: %s', camera.name, message);
            }
          });
          
          out.once('close', () => { 
            try { ff.kill('SIGKILL'); } catch {} 
          });
          
          out.once('error', () => {
            try { ff.kill('SIGKILL'); } catch {} 
          });
          
          return out;
        } else {
          // Clean up failed attempt
          try { ff.kill('SIGKILL'); } catch {}
        }
      } // End audio mapping strategies
    } // End transport loop
  } // End candidates loop

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
