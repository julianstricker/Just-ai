import { Readable } from 'stream';
import { OpenAI } from 'openai';
import { loadConfig } from '../config/index.js';

const config = loadConfig();
const openai = new OpenAI({ apiKey: config.openai.apiKey });

export async function detectWakeWord(audioStream: Readable, wakeWord: string): Promise<boolean> {
  const transcript = await openai.audio.transcriptions.create({
    model: config.openai.transcriptionModel,
    file: audioStream as any,
    response_format: 'verbose_json'
  });

  const text = transcript.text?.toLowerCase() ?? '';
  return text.includes(wakeWord.toLowerCase());
}
