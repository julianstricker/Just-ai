import onvif from 'onvif';
const { Cam } = onvif;
import { EventEmitter } from 'eventemitter3';
import { logger } from '../config/logger.js';
import { CameraInfo, StateStore, KnownPerson } from '../storage/state.js';
import { VisionClient, VisionResult } from '../vision/vision-client.js';
import { WakeWordDetector } from './wake-word-detector.js';
import { VoiceSessionManager } from '../realtime/voice-session-manager.js';
import { cosineSimilarity } from '../utils/embeddings.js';
import { CameraDiscoveryService, DiscoveredCamera } from './camera-discovery.js';
import { grabRtspFrameAsDataUrl } from '../utils/rtsp-snapshot.js';

export interface CameraEventMap {
  wakeword: { camera: CameraInfo };
  detection: { camera: CameraInfo; result: VisionResult };
}

type CameraEvent = keyof CameraEventMap;

export class CameraManager extends EventEmitter {
  private readonly onvifCameras = new Map<string, InstanceType<typeof Cam>>();
  private readonly wakeDetectors = new Map<string, WakeWordDetector>();
  private readonly snapshotTimers = new Map<string, NodeJS.Timeout>();
  private readonly latestDetections = new Map<string, VisionResult>();
  private readonly discoveryService = new CameraDiscoveryService();

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

    if (!info.username || !info.password) {
      throw new Error('Camera username and password are required for ONVIF connection');
    }

    // Ensure we do not accumulate duplicate listeners when a camera configuration is updated.
    if (this.onvifCameras.has(info.id)) {
      await this.detachCamera(info.id);
    }

    let cam: InstanceType<typeof Cam>;
    let usedPort = info.port ?? 80;
    // ONVIF device services typically run on HTTP port (default 80). RTSP default (554) is not used for ONVIF control.
    const candidatePorts = (() => {
      if (typeof info.port === 'number') {
        if (info.port === 554) {
          // User entered RTSP port by mistake: try ONVIF default 80 instead
          return [80];
        }
        return [info.port];
      }
      // When no port is provided, only try ONVIF default HTTP port 80
      return [80];
    })();

    let lastError: unknown;
    for (const port of candidatePorts) {
      try {
        // eslint-disable-next-line no-await-in-loop
        cam = await new Promise<InstanceType<typeof Cam>>((resolve, reject) => {
          const instance = new Cam(
            {
              hostname: info.host,
              username: info.username!,
              password: info.password!,
              port
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
        usedPort = port;
        logger.info('Camera %s initialised on port %d', info.name, usedPort);
        // Update stored port if it changed
        if (info.port !== usedPort) {
          info.port = usedPort;
          await this.store.upsertCamera(info);
        }
        break;
      } catch (err) {
        lastError = err;
        logger.warn('Failed to initialise %s on port %d: %s', info.name, port, (err as Error).message);
      }
    }

    // If cam was never assigned, rethrow last error
    // @ts-expect-error - cam is assigned when initialisation succeeds
    if (!cam) {
      const message = (lastError as Error | undefined)?.message ?? 'Unknown error';
      logger.error('Failed to initialise camera %s: %s', info.name, message);
      await this.store.addLog({ level: 'error', message: `Failed to initialise camera ${info.name}: ${message}` });
      throw lastError instanceof Error ? lastError : new Error(String(lastError));
    }

    this.onvifCameras.set(info.id, cam);

    // Optional: fetch profiles and log RTSP stream URI (example4.js pattern)
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await new Promise<void>((resolve) => {
        // @ts-expect-error onvif typings are partial; methods exist at runtime
        cam.getProfiles((err: any, profiles: any[]) => {
          if (err || !profiles || profiles.length === 0) {
            resolve();
            return;
          }
          const profileToken = profiles[0].token;
          // Persist token for later usage
          void this.store.upsertCamera({ ...info, profileToken });
          // @ts-expect-error onvif typings are partial; methods exist at runtime
          cam.getStreamUri({ protocol: 'RTSP', profileToken }, (uErr: any, stream: any) => {
            if (!uErr && stream?.uri) {
              logger.info('RTSP URI for %s: %s', info.name, stream.uri);
            }
            resolve();
          });
        });
      });
    } catch {
      // ignore optional stream URI fetch errors
    }

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
      // Try ONVIF snapshot first
      let snapshotSource: string | undefined;
      try {
        snapshotSource = await new Promise<string>((resolve, reject) => {
          // onvif typings are partial; method exists at runtime
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (cam as any).getSnapshotUri({}, (err: any, result: any) => {
            if (err || !result?.uri) {
              reject(err ?? new Error('Missing snapshot URI'));
              return;
            }
            resolve(result.uri as string);
          });
        });
      } catch (err) {
        // If camera does not support snapshot (ActionNotSupported), fall back to RTSP one-frame grab
        logger.warn('Snapshot URI unavailable for %s, falling back to RTSP: %s', camera.name, (err as Error).message);
        let rtspUrl: string | undefined = camera.rtspUrl;
        if (!rtspUrl) {
          rtspUrl = await new Promise((resolve) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (cam as any).getProfiles((pErr: any, profiles: any[]) => {
            if (pErr || !profiles?.[0]?.token) return resolve(undefined);
            const token = profiles[0].token;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (cam as any).getStreamUri({ protocol: 'RTSP', profileToken: token }, async (uErr: any, stream: any) => {
              if (uErr || !stream?.uri) return resolve(undefined);
              resolve(stream.uri as string);
            });
          });
          });
        }
        // As a last resort, try common default path using RTSP default port
        if (!rtspUrl) {
          rtspUrl = `rtsp://${camera.host}/stream1`;
        }
        // Inject or replace credentials in RTSP URL, percent-encoded
        let effectiveRtspUrl = rtspUrl;
        if (camera.username) {
          const encUser = encodeURIComponent(camera.username);
          const encPass = encodeURIComponent(camera.password ?? '');
          try {
            const u = new URL(rtspUrl);
            // rebuild without existing userinfo to avoid unencoded characters
            const hostAndPath = `${u.host}${u.pathname}${u.search}`;
            effectiveRtspUrl = `rtsp://${encUser}:${encPass}@${hostAndPath}`;
          } catch {
            const prefix = 'rtsp://';
            if (rtspUrl.startsWith(prefix)) {
              const rest = rtspUrl.substring(prefix.length).replace(/^([^@]+)@/, '');
              effectiveRtspUrl = `${prefix}${encUser}:${encPass}@${rest}`;
            }
          }
        }
        snapshotSource = await grabRtspFrameAsDataUrl(effectiveRtspUrl);
      }

      await this.store.upsertCamera({ ...camera, lastSnapshotUrl: snapshotSource });
      camera.lastSnapshotUrl = snapshotSource;
      const visionResult = await this.vision.analyzeSnapshot(snapshotSource, camera);
      this.latestDetections.set(camera.id, visionResult);
      await this.handleDetections(camera, visionResult);
      if (visionResult.alarms.length > 0) {
        await this.store.addLog({
          level: 'alarm',
          message: `${camera.name}: ${visionResult.alarms.join(', ')}`,
          metadata: visionResult as unknown as Record<string, unknown>
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

  async discoverCameras(timeoutMs = 10000): Promise<DiscoveredCamera[]> {
    return await this.discoveryService.discoverCameras(timeoutMs);
  }

  getDiscoveredCameras(): DiscoveredCamera[] {
    return this.discoveryService.getDiscoveredCameras();
  }
}
