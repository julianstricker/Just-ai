import { Readable } from 'stream';
import { OpenAI } from 'openai';
import { toFile } from 'openai/uploads';
import { logger } from '../config/logger.js';
import { loadConfig } from '../config/index.js';

const config = loadConfig();
const openai = new OpenAI({ apiKey: config.openai.apiKey });

export async function detectWakeWord(audioStream: Readable, wakeWord: string): Promise<boolean> {
  // Chunk audio into a short buffer (e.g., 2s) and send to OpenAI
  const chunks: Buffer[] = [];
  let total = 0;
  const limitBytes = 2 * 16000 * 2; // 2s * 16kHz * 16-bit mono (reduced for faster response)
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
    const timer = setTimeout(onTimeout, 3000); // Reduced timeout
    audioStream.on('data', onData);
    audioStream.on('end', onEnd);
  });

  if (collected.length === 0) return false;
  
  // Only process if we have enough audio data
  if (collected.length < 1000) {
    logger.debug('Insufficient audio data for wake word detection: %d bytes', collected.length);
    return false;
  }
  
  logger.debug('Wakeword audio chunk collected: %d bytes', collected.length);
  
  try {
    // Wrap PCM into a WAV container to satisfy file type requirements
    const file = await toFile(collected, 'chunk.wav', { type: 'audio/wav' as any });
    const transcript = await openai.audio.transcriptions.create({
      model: config.openai.transcriptionModel,
      file,
      response_format: 'json',
      language: 'en' // Specify language for better accuracy
    });
    
    const text = transcript.text?.toLowerCase() ?? '';
    const wakeWordLower = wakeWord.toLowerCase();
    const detected = text.includes(wakeWordLower);
    
    if (detected) {
      logger.info('Wake word "%s" detected in transcript: "%s"', wakeWord, text);
    } else {
      logger.debug('No wake word in transcript: "%s"', text);
    }
    
    return detected;
  } catch (err) {
    logger.error('Error during wake word detection: %s', (err as Error).message);
    return false;
  } finally {
    try {
      // Ensure the ingest ffmpeg process is torn down after each chunk
      (audioStream as any)?.destroy?.();
    } catch (err) {
      logger.warn('Error destroying audio stream: %s', (err as Error).message);
    }
  }
}
