import axios, { AxiosInstance } from 'axios';
import { CameraInfo } from '../storage/state.js';
import { logger } from '../config/logger.js';
import { loadConfig } from '../config/index.js';

const config = loadConfig();

function createClient(): AxiosInstance {
  const instance = axios.create({
    baseURL: config.vision.endpoint,
    timeout: 10000,
    validateStatus: (s) => s >= 200 && s < 300,
  });
  return instance;
}

const client = createClient();

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
    const payload = {
      cameraId: camera.id,
      snapshotUri,
      credentials: camera.username ? { username: camera.username, password: camera.password } : null,
    };
    try {
      const response = await client.post('/analyze', payload);
      return response.data as VisionResult;
    } catch (err) {
      // retry once in case of transient socket issues
      const response = await client.post('/analyze', payload);
      return response.data as VisionResult;
    }
  }

  async fetchSnapshot(camera: CameraInfo): Promise<string> {
    const response = await client.post('/snapshot', { camera });
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
