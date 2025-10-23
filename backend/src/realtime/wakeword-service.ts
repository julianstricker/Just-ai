import { Readable } from 'stream';
import { OpenAI } from 'openai';
import { toFile } from 'openai/uploads';
import { logger } from '../config/logger.js';
import { loadConfig } from '../config/index.js';

const config = loadConfig();
const openai = new OpenAI({ apiKey: config.openai.apiKey });

export async function detectWakeWord(audioStream: Readable, wakeWord: string): Promise<boolean> {
  // Chunk audio into a short buffer (e.g., 3s) and send to OpenAI
  const chunks: Buffer[] = [];
  let total = 0;
  const limitBytes = 3 * 16000 * 2; // 3s * 16kHz * 16-bit mono
  const collected = await new Promise<Buffer>((resolve) => {
    const onData = (d: Buffer) => {
      chunks.push(d);
      total += d.length;
      if (total >= limitBytes) {
        cleanup();
        resolve(Buffer.concat(chunks));
      }
    };
    const onEnd = () => {
      cleanup();
      resolve(Buffer.concat(chunks));
    };
    const onTimeout = () => {
      logger.warn('Wakeword audio chunk timeout with %d bytes collected', total);
      cleanup();
      resolve(Buffer.concat(chunks));
    };
    const cleanup = () => {
      audioStream.off('data', onData);
      audioStream.off('end', onEnd);
      clearTimeout(timer);
    };
    const timer = setTimeout(onTimeout, 5000);
    audioStream.on('data', onData);
    audioStream.on('end', onEnd);
  });

  if (collected.length === 0) return false;
  logger.info('Wakeword audio chunk collected: %d bytes', collected.length);
  // Wrap PCM into a WAV container to satisfy file type requirements
  const file = await toFile(collected, 'chunk.wav', { type: 'audio/wav' as any });
  const transcript = await openai.audio.transcriptions.create({
    model: config.openai.transcriptionModel,
    file,
    response_format: 'json'
  });
  const text = transcript.text?.toLowerCase() ?? '';
  try {
    // Ensure the ingest ffmpeg process is torn down after each chunk
    (audioStream as any)?.destroy?.();
  } catch {}
  return text.includes(wakeWord.toLowerCase());
}
