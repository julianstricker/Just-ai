import axios from 'axios';
import { CameraInfo } from '../storage/state.js';
import { logger } from '../config/logger.js';
import { loadConfig } from '../config/index.js';

const config = loadConfig();

export interface DetectedPerson {
  bbox: [number, number, number, number];
  confidence: number;
  embedding: number[];
}

export interface VisionResult {
  objects: { label: string; confidence: number; bbox: [number, number, number, number] }[];
  people: DetectedPerson[];
  alarms: string[];
  snapshotDataUrl?: string;
}

export class VisionClient {
  async analyzeSnapshot(snapshotUri: string, camera: CameraInfo): Promise<VisionResult> {
    const response = await axios.post(`${config.vision.endpoint}/analyze`, {
      cameraId: camera.id,
      snapshotUri,
      credentials: camera.username
        ? { username: camera.username, password: camera.password }
        : null
    });
    return response.data as VisionResult;
  }

  async fetchSnapshot(camera: CameraInfo): Promise<string> {
    const response = await axios.post(`${config.vision.endpoint}/snapshot`, { camera });
    return response.data?.dataUrl;
  }

  async controlPtz(camera: CameraInfo, params: { pan?: number; tilt?: number; zoom?: number }) {
    try {
      await axios.post(`${config.vision.endpoint}/ptz`, { camera, params });
    } catch (err) {
      logger.warn('Failed to control PTZ for %s: %s', camera.name, (err as Error).message);
    }
  }
}
