import { PassThrough } from 'stream';
import { CameraInfo } from '../storage/state.js';

/**
 * Placeholder implementation for two-way audio.
 * In production this module would open the ONVIF backchannel RTP stream
 * and pipe audio frames to and from the camera.
 */
export async function createAudioStream(_camera: CameraInfo) {
  // For now we return a PassThrough stream that consumers can write into.
  // Integrators can extend this function to hook into the vendor SDK
  // or use libraries like rtsp-ffmpeg to handle the bidirectional audio.
  return new PassThrough();
}

export async function playAudioToCamera(camera: CameraInfo, audioBuffer: Buffer) {
  const stream = await createAudioStream(camera);
  stream.end(audioBuffer);
}
