import { Router } from 'express';
import { StateStore } from '../storage/state.js';
import { CameraManager } from '../cameras/camera-manager.js';
import { logger } from '../config/logger.js';

export function createAdminRouter(store: StateStore, cameraManager: CameraManager) {
  const router = Router();

  router.get('/state', (_req, res) => {
    res.json(store.snapshot);
  });

  router.post('/cameras', async (req, res, next) => {
    try {
      const camera = req.body;
      await store.upsertCamera(camera);
      await cameraManager.attachCamera(camera);
      res.status(201).json(camera);
    } catch (err) {
      next(err);
    }
  });

  router.delete('/cameras/:id', async (req, res, next) => {
    try {
      const id = req.params.id;
      await store.removeCamera(id);
      await cameraManager.detachCamera(id);
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

  return router;
}
