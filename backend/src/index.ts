import express from 'express';
import cors from 'cors';
import { loadConfig } from './config/index.js';
import { logger } from './config/logger.js';
import { StateStore } from './storage/state.js';
import { VisionClient } from './vision/vision-client.js';
import { VoiceSessionManager } from './realtime/voice-session-manager.js';
import { CameraManager } from './cameras/camera-manager.js';
import { createAdminRouter } from './routes/admin.js';

async function bootstrap() {
  const config = loadConfig();
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '5mb' }));

  const store = new StateStore(config.storage.stateFile);
  await store.init();

  const vision = new VisionClient();
  const voiceSessions = new VoiceSessionManager(store, vision);
  const cameraManager = new CameraManager(store, vision, voiceSessions, config.cameras);
  voiceSessions.setCameraManager(cameraManager);
  await cameraManager.loadFromState();

  app.use('/admin', createAdminRouter(store, cameraManager));

  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    logger.error(err.message, { stack: err.stack });
    res.status(500).json({ error: err.message });
  });

  app.listen(config.server.port, () => {
    logger.info(`Server listening on port ${config.server.port}`);
  });
}

bootstrap().catch((err) => {
  logger.error('Fatal error during bootstrap: %s', err.message);
  process.exit(1);
});
