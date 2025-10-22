import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { z } from 'zod';
import { StateStore, CameraInfo } from '../storage/state.js';
import { CameraManager } from '../cameras/camera-manager.js';
import { logger } from '../config/logger.js';
import { spawn } from 'node:child_process';
import ffmpegPath from 'ffmpeg-static';

const cameraSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1),
  host: z.string().min(1),
  port: z.preprocess(
    (v) => (v === '' || v === null ? undefined : v),
    z.number().int().positive().max(65535).optional()
  ),
  rtspUrl: z.preprocess(
    (v) => (v === '' || v === null ? undefined : v),
    z.string().url().optional()
  ),
  rtspAudioUrl: z.preprocess(
    (v) => (v === '' || v === null ? undefined : v),
    z.string().url().optional()
  ),
  talkRtspUrl: z.preprocess(
    (v) => (v === '' || v === null ? undefined : v),
    z.string().url().optional()
  ),
  username: z.string().optional(),
  password: z.string().optional(),
  profileToken: z.string().optional(),
  audioSupported: z.boolean().optional()
});

export function createAdminRouter(store: StateStore, cameraManager: CameraManager) {
  const router = Router();

  router.get('/state', (_req, res) => {
    res.json(store.snapshot);
  });

  router.post('/cameras', async (req, res, next) => {
    try {
      const parsed = cameraSchema.parse(req.body);
      console.log(parsed);
      const camera: CameraInfo = { ...parsed, id: parsed.id ?? uuid() };
      await cameraManager.attachCamera(camera);
      await store.upsertCamera(camera);
      res.status(201).json(camera);
    } catch (err) {
      next(err);
    }
  });

  router.delete('/cameras/:id', async (req, res, next) => {
    try {
      const id = z.string().uuid().parse(req.params.id);
      await cameraManager.detachCamera(id);
      await store.removeCamera(id);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  });

  router.post('/logs', async (req, res, next) => {
    try {
      const entry = await store.addLog(req.body);
      res.status(201).json(entry);
    } catch (err) {
      next(err);
    }
  });

  router.post('/people', async (req, res, next) => {
    try {
      const person = await store.registerPerson(req.body);
      res.status(201).json(person);
    } catch (err) {
      next(err);
    }
  });

  router.post('/simulate-alarm', async (req, res) => {
    const { cameraId, message } = req.body;
    await store.addLog({ level: 'alarm', message: message ?? `Alarm triggered on ${cameraId}` });
    logger.warn('Simulated alarm triggered for %s: %s', cameraId, message);
    res.json({ status: 'ok' });
  });

  router.get('/cameras/discover', async (req, res, next) => {
    try {
      const timeout = req.query.timeout ? parseInt(req.query.timeout as string, 10) : 10000;
      const discoveredCameras = await cameraManager.discoverCameras(timeout);
      res.json(discoveredCameras);
    } catch (err) {
      next(err);
    }
  });

  router.get('/cameras/:id/latest-detection', async (req, res, next) => {
    try {
      const id = z.string().uuid().parse(req.params.id);
      const detection = cameraManager.getLatestDetection(id);
      res.json(detection ?? null);
    } catch (err) {
      next(err);
    }
  });

  router.get('/cameras/:id/live.mjpg', async (req, res, next) => {
    try {
      const id = z.string().uuid().parse(req.params.id);
      const camera = store.snapshot.cameras.find((c) => c.id === id);
      if (!camera) {
        res.status(404).send('Camera not found');
        return;
      }
      if (!ffmpegPath) {
        res.status(500).send('ffmpeg not available');
        return;
      }

      // Build RTSP URL with optional credentials
      let rtspUrl = camera.rtspUrl ?? `rtsp://${camera.host}/stream1`;
      if (camera.username) {
        try {
          const u = new URL(rtspUrl);
          if (!u.username) {
            u.username = camera.username;
            u.password = camera.password ?? '';
            rtspUrl = u.toString();
          }
        } catch {
          const prefix = 'rtsp://';
          if (rtspUrl.startsWith(prefix)) {
            const rest = rtspUrl.substring(prefix.length);
            rtspUrl = `${prefix}${encodeURIComponent(camera.username)}:${encodeURIComponent(camera.password ?? '')}@${rest}`;
          }
        }
      }

      res.writeHead(200, {
        'Content-Type': 'multipart/x-mixed-replace; boundary=frame',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        Pragma: 'no-cache'
      });

      const args = [
        '-rtsp_transport', 'tcp',
        '-i', rtspUrl,
        '-f', 'mpjpeg',
        '-boundary_tag', 'frame',
        '-r', '10',
        '-q:v', '5',
        'pipe:1'
      ];
      const ff = spawn(ffmpegPath as string, args, { stdio: ['ignore', 'pipe', 'pipe'] });

      ff.stdout?.pipe(res);
      ff.stderr?.on('data', (d) => logger.debug?.(d.toString()));

      const cleanup = () => {
        try { ff.kill('SIGKILL'); } catch {}
      };
      req.on('close', cleanup);
      ff.on('close', cleanup);
    } catch (err) {
      next(err);
    }
  });

  router.get('/cameras/:id/snapshot.jpg', async (req, res, next) => {
    try {
      const id = z.string().uuid().parse(req.params.id);
      const camera = store.snapshot.cameras.find((c) => c.id === id);
      if (!camera) {
        res.status(404).send('Camera not found');
        return;
      }
      if (!ffmpegPath) {
        res.status(500).send('ffmpeg not available');
        return;
      }
      let rtspUrl = camera.rtspUrl ?? `rtsp://${camera.host}/stream1`;
      if (camera.username) {
        const encUser = encodeURIComponent(camera.username);
        const encPass = encodeURIComponent(camera.password ?? '');
        try {
          const u = new URL(rtspUrl);
          const hostAndPath = `${u.host}${u.pathname}${u.search}`;
          rtspUrl = `rtsp://${encUser}:${encPass}@${hostAndPath}`;
        } catch {
          const prefix = 'rtsp://';
          if (rtspUrl.startsWith(prefix)) {
            const rest = rtspUrl.substring(prefix.length).replace(/^([^@]+)@/, '');
            rtspUrl = `${prefix}${encUser}:${encPass}@${rest}`;
          }
        }
      }
      res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-cache' });
      const args = [
        '-rtsp_transport', 'tcp',
        '-i', rtspUrl,
        '-frames:v', '1',
        '-f', 'image2',
        '-vcodec', 'mjpeg',
        'pipe:1'
      ];
      const ff = spawn(ffmpegPath as string, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      ff.stdout?.pipe(res);
      const cleanup = () => { try { ff.kill('SIGKILL'); } catch {} };
      ff.on('close', cleanup);
      req.on('close', cleanup);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
