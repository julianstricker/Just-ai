import { Readable } from 'stream';
import { OpenAI } from 'openai';
import { toFile } from 'openai/uploads';
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
        audioStream.off('data', onData);
        resolve(Buffer.concat(chunks));
      }
    };
    audioStream.on('data', onData);
    audioStream.on('end', () => resolve(Buffer.concat(chunks)));
  });

  if (collected.length === 0) return false;
  const file = await toFile(collected, 'chunk.pcm');
  const transcript = await openai.audio.transcriptions.create({
    model: config.openai.transcriptionModel,
    file,
    response_format: 'json'
  });
  const text = transcript.text?.toLowerCase() ?? '';
  return text.includes(wakeWord.toLowerCase());
}
