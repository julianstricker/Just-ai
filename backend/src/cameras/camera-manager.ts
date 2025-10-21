import { Cam } from 'onvif';
import { EventEmitter } from 'eventemitter3';
import { logger } from '../config/logger.js';
import { CameraInfo, StateStore, KnownPerson } from '../storage/state.js';
import { VisionClient, VisionResult } from '../vision/vision-client.js';
import { WakeWordDetector } from './wake-word-detector.js';
import { VoiceSessionManager } from '../realtime/voice-session-manager.js';
import { cosineSimilarity } from '../utils/embeddings.js';

export interface CameraEventMap {
  wakeword: { camera: CameraInfo };
  detection: { camera: CameraInfo; result: VisionResult };
}

type CameraEvent = keyof CameraEventMap;

export class CameraManager extends EventEmitter {
  private readonly onvifCameras = new Map<string, Cam>();
  private readonly wakeDetectors = new Map<string, WakeWordDetector>();
  private readonly snapshotTimers = new Map<string, NodeJS.Timeout>();
  private readonly latestDetections = new Map<string, VisionResult>();

  constructor(
    private readonly store: StateStore,
    private readonly vision: VisionClient,
    private readonly voiceSessions: VoiceSessionManager,
    private readonly config: { snapshotIntervalMs: number; wakeWord: string }
  ) {
    super();
  }

  async loadFromState() {
    const state = this.store.snapshot;
    for (const camera of state.cameras) {
      try {
        await this.attachCamera(camera);
      } catch (err) {
        logger.warn('Skipping camera %s during load: %s', camera.name, (err as Error).message);
      }
    }
  }

  async attachCamera(info: CameraInfo) {
    logger.info('Attaching camera %s', info.name);
    if (!info.id) {
      throw new Error('Camera must have an id before attachment');
    }

    // Ensure we do not accumulate duplicate listeners when a camera configuration is updated.
    if (this.onvifCameras.has(info.id)) {
      await this.detachCamera(info.id);
    }

    let cam: Cam;
    try {
      cam = await new Promise<Cam>((resolve, reject) => {
        const instance = new Cam(
          {
            hostname: info.host,
            username: info.username,
            password: info.password,
            port: 80
          },
          (err) => {
            if (err) {
              reject(err);
              return;
            }
            resolve(instance);
          }
        );
      });
      logger.info('Camera %s initialised', info.name);
    } catch (err) {
      const message = (err as Error).message;
      logger.error('Failed to initialise camera %s: %s', info.name, message);
      await this.store.addLog({
        level: 'error',
        message: `Failed to initialise camera ${info.name}: ${message}`
      });
      throw err;
    }

    this.onvifCameras.set(info.id, cam);

    const wakeDetector = new WakeWordDetector(info, this.config.wakeWord, async () => {
      logger.info('Wake word detected on %s', info.name);
      await this.store.addLog({ level: 'info', message: `Wake word detected on ${info.name}` });
      this.emit('wakeword', { camera: info });
      await this.voiceSessions.startSession(info);
    });
    this.wakeDetectors.set(info.id, wakeDetector);
    wakeDetector.start();

    const timer = setInterval(async () => {
      await this.captureAndAnalyze(info);
    }, this.config.snapshotIntervalMs);
    this.snapshotTimers.set(info.id, timer);
  }

  async detachCamera(id: string) {
    const cam = this.onvifCameras.get(id);
    if (cam) {
      try {
        cam.removeAllListeners();
      } catch (err) {
        logger.warn('Failed to detach camera gracefully: %s', (err as Error).message);
      }
      this.onvifCameras.delete(id);
    }
    const wake = this.wakeDetectors.get(id);
    if (wake) {
      wake.stop();
      this.wakeDetectors.delete(id);
    }
    const timer = this.snapshotTimers.get(id);
    if (timer) {
      clearInterval(timer);
      this.snapshotTimers.delete(id);
    }
  }

  async captureAndAnalyze(camera: CameraInfo) {
    try {
      const cam = this.onvifCameras.get(camera.id);
      if (!cam) {
        return;
      }
      const snapshotUri = await new Promise<string>((resolve, reject) => {
        cam.getSnapshotUri({}, (err, result) => {
          if (err || !result?.uri) {
            reject(err ?? new Error('Missing snapshot URI'));
            return;
          }
          resolve(result.uri);
        });
      });
      await this.store.upsertCamera({ ...camera, lastSnapshotUrl: snapshotUri });
      camera.lastSnapshotUrl = snapshotUri;
      const visionResult = await this.vision.analyzeSnapshot(snapshotUri, camera);
      this.latestDetections.set(camera.id, visionResult);
      await this.handleDetections(camera, visionResult);
      if (visionResult.alarms.length > 0) {
        await this.store.addLog({
          level: 'alarm',
          message: `${camera.name}: ${visionResult.alarms.join(', ')}`,
          metadata: visionResult
        });
      }
      this.emit('detection', { camera, result: visionResult });
    } catch (err) {
      logger.error('Failed to capture/analyze from %s: %s', camera.name, (err as Error).message);
    }
  }

  private async handleDetections(camera: CameraInfo, result: VisionResult) {
    if (result.people.length === 0) {
      return;
    }
    const known = this.store.snapshot.people;
    const matches: { person: KnownPerson; similarity: number }[] = [];
    const unknownEmbeddings: number[][] = [];

    for (const person of result.people) {
      let best: { person: KnownPerson; similarity: number } | undefined;
      for (const knownPerson of known) {
        try {
          const similarity = cosineSimilarity(person.embedding, knownPerson.faceEmbedding);
          if (!best || similarity > best.similarity) {
            best = { person: knownPerson, similarity };
          }
        } catch (err) {
          logger.warn('Failed to compare embeddings: %s', (err as Error).message);
        }
      }

      if (best && best.similarity > 0.8) {
        matches.push(best);
        await this.store.updateLastSeen(best.person.id, camera.id);
      } else {
        unknownEmbeddings.push(person.embedding);
      }
    }

    if (matches.length > 0) {
      const names = matches.map((m) => m.person.name).join(', ');
      await this.store.addLog({
        level: 'info',
        message: `${camera.name}: recognised ${names}`,
        metadata: { matches }
      });
    }

    if (unknownEmbeddings.length > 0) {
      await this.store.addLog({
        level: 'warn',
        message: `${camera.name}: detected ${unknownEmbeddings.length} unknown person(s)`,
        metadata: { embeddings: unknownEmbeddings }
      });
    }
  }

  getLatestDetection(cameraId: string) {
    return this.latestDetections.get(cameraId);
  }
}
