import fs from 'fs';
import path from 'path';
import { z } from 'zod';

const configSchema = z.object({
  server: z.object({
    port: z.number().default(8080),
    publicUrl: z.string().url().optional()
  }),
  openai: z.object({
    apiKey: z.string(),
    realtimeModel: z.string().default('gpt-4o-realtime-preview-2024-04-09'),
    transcriptionModel: z.string().default('gpt-4o-mini-transcribe')
  }),
  storage: z.object({
    stateFile: z.string().default(path.resolve(process.cwd(), '../data/state.json'))
  }),
  cameras: z.object({
    snapshotIntervalMs: z.number().default(5000),
    wakeWord: z.string().default('hey guardian')
  }),
  vision: z.object({
    endpoint: z.string().default('http://vision-service:8000')
  })
});

type AppConfig = z.infer<typeof configSchema>;

const defaultConfig: AppConfig = {
  server: {
    port: Number(process.env.PORT) || 8080,
    publicUrl: process.env.PUBLIC_URL
  },
  openai: {
    apiKey: process.env.OPENAI_API_KEY || '',
    realtimeModel: process.env.OPENAI_REALTIME_MODEL || 'gpt-4o-realtime-preview-2024-04-09',
    transcriptionModel: process.env.OPENAI_TRANSCRIBE_MODEL || 'gpt-4o-mini-transcribe'
  },
  storage: {
    stateFile: process.env.STATE_FILE || path.resolve(process.cwd(), '../data/state.json')
  },
  cameras: {
    snapshotIntervalMs: Number(process.env.SNAPSHOT_INTERVAL_MS || 5000),
    wakeWord: process.env.WAKE_WORD || 'hey guardian'
  },
  vision: {
    endpoint: process.env.VISION_ENDPOINT || 'http://vision-service:8000'
  }
};

export function loadConfig(): AppConfig {
  const overridePath = process.env.CONFIG_FILE;
  if (!overridePath) {
    return configSchema.parse(defaultConfig);
  }

  const file = fs.readFileSync(path.resolve(overridePath), 'utf-8');
  const parsed = configSchema.partial().parse(JSON.parse(file));
  return configSchema.parse({ ...defaultConfig, ...parsed });
}

export type { AppConfig };
