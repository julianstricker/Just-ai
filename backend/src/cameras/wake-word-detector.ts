import { logger } from '../config/logger.js';
import { CameraInfo } from '../storage/state.js';
import { createAudioStream } from '../audio/twoway-audio.js';
import { detectWakeWord } from '../realtime/wakeword-service.js';

export class WakeWordDetector {
  private running = false;
  constructor(
    private readonly camera: CameraInfo,
    private readonly wakeWord: string,
    private readonly onWake: () => Promise<void> | void
  ) {}

  async start() {
    if (this.running) return;
    this.running = true;
    logger.info('Starting wake word detector for %s', this.camera.name);
    this.loop();
  }

  async stop() {
    this.running = false;
  }

  private async loop() {
    while (this.running) {
      try {
        const audioStream = await createAudioStream(this.camera);
        const detected = await detectWakeWord(audioStream, this.wakeWord);
        if (detected && this.running) {
          await this.onWake();
        }
      } catch (err) {
        logger.warn('Wake word detection error for %s: %s', this.camera.name, (err as Error).message);
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  }
}
