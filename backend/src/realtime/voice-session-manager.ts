import { EventEmitter } from 'eventemitter3';
import WebSocket from 'ws';
import { logger } from '../config/logger.js';
import { loadConfig } from '../config/index.js';
import { CameraInfo } from '../storage/state.js';
import { playAudioToCamera, createAudioStream } from '../audio/twoway-audio.js';
import { StateStore } from '../storage/state.js';
import { VisionClient } from '../vision/vision-client.js';
import { toolDefinitions, handleToolCall } from './tools.js';
import type { CameraManager } from '../cameras/camera-manager.js';

interface VoiceSessionEvents {
  closed: { camera: CameraInfo };
}

type EventKey = keyof VoiceSessionEvents;

const config = loadConfig();

export class VoiceSessionManager extends EventEmitter<EventKey> {
  private activeSessions = new Map<string, NodeJS.Timeout>();
  private cameraManager?: CameraManager;

  constructor(private readonly store: StateStore, private readonly vision: VisionClient) {
    super();
  }

  setCameraManager(manager: CameraManager) {
    this.cameraManager = manager;
  }

  async startSession(camera: CameraInfo) {
    const existing = this.activeSessions.get(camera.id);
    if (existing) {
      clearTimeout(existing);
    }

    const ws = await this.createRealtimeConnection(camera);
    this.pumpInputAudio(camera, ws).catch((err) => {
      logger.warn('Audio pump error for %s: %s', camera.name, err.message);
    });
    const stopTimer = this.createStopTimer(camera, () => {
      logger.info('Voice session timed out for %s', camera.name);
      ws.close();
    });

    this.activeSessions.set(camera.id, stopTimer);

    ws.on('message', async (data) => {
      const parsed = JSON.parse(data.toString());
      if (parsed.type === 'response.audio.delta' && parsed.audio) {
        await playAudioToCamera(camera, Buffer.from(parsed.audio, 'base64'));
      }
      if (parsed.type === 'response.completed') {
        const timer = this.createStopTimer(camera, () => ws.close());
        this.activeSessions.set(camera.id, timer);
      }
      if (parsed.type === 'response.output_text.delta') {
        logger.info('%s <- %s', camera.name, parsed.text);
      }
      if (parsed.type === 'response.output_tool_call') {
        const toolName = parsed.tool.name;
        const args = parsed.tool.arguments;
        const result = await handleToolCall(toolName, args, {
          camera,
          store: this.store,
          vision: this.vision,
          cameraManager: this.cameraManager as CameraManager
        });
        ws.send(
          JSON.stringify({
            type: 'response.tool_output',
            tool_call_id: parsed.tool_call_id,
            output: result
          })
        );
      }
    });

    ws.on('close', () => {
      logger.info('Voice session closed for %s', camera.name);
      const timer = this.activeSessions.get(camera.id);
      if (timer) {
        clearTimeout(timer);
      }
      this.activeSessions.delete(camera.id);
      this.emit('closed', { camera });
    });
  }

  private createStopTimer(camera: CameraInfo, handler: () => void) {
    return setTimeout(handler, 8_000);
  }

  private async createRealtimeConnection(camera: CameraInfo) {
    const url = `wss://api.openai.com/v1/realtime?model=${config.openai.realtimeModel}`;
    const ws = new WebSocket(url, {
      headers: {
        Authorization: `Bearer ${config.openai.apiKey}`,
        'OpenAI-Beta': 'realtime=v1',
        'x-openai-session-id': camera.id
      }
    });

    ws.on('open', () => {
      logger.info('Realtime session opened for %s', camera.name);
      ws.send(
        JSON.stringify({
          type: 'session.update',
          session: {
            modalities: ['text', 'audio', 'vision'],
            instructions: this.buildInstructions(camera),
            tools: toolDefinitions
          }
        })
      );
      // Kick off an initial response so TTS audio starts flowing after wake word
      ws.send(
        JSON.stringify({
          type: 'response.create',
          response: {
            modalities: ['audio'],
            instructions: 'Hello, how can I help you?',
          }
        })
      );
    });

    ws.on('error', (err) => {
      logger.error('Realtime session error for %s: %s', camera.name, (err as Error).message);
    });

    return ws;
  }

  private buildInstructions(camera: CameraInfo) {
    return `You are Guardian, a helpful assistant connected to camera ${camera.name}.
You can see what the camera sees when the user asks. Use the provided tools to fetch
snapshots or pan/tilt/zoom the camera. When you mention people, use their known names
if available; otherwise ask who they are and store their embedding via the register_person tool.`;
  }

  private async pumpInputAudio(camera: CameraInfo, ws: WebSocket) {
    const audioStream = await createAudioStream(camera);
    let lastChunkTs = Date.now();
    const inactivityTimeoutMs = 5000;

    const inactivityTimer = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN && Date.now() - lastChunkTs > inactivityTimeoutMs) {
        ws.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
        lastChunkTs = Date.now();
      }
    }, 1000);

    const cleanup = () => {
      clearInterval(inactivityTimer);
      audioStream.removeAllListeners();
    };

    ws.on('close', cleanup);
    ws.on('error', cleanup);

    audioStream.on('data', (chunk: Buffer) => {
      lastChunkTs = Date.now();
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({
            type: 'input_audio_buffer.append',
            audio: chunk.toString('base64')
          })
        );
      }
    });

    audioStream.on('end', () => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
      }
      cleanup();
    });
  }
}
