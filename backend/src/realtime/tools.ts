import { CameraManager } from '../cameras/camera-manager.js';
import { VisionClient } from '../vision/vision-client.js';
import { CameraInfo, StateStore } from '../storage/state.js';
import { logger } from '../config/logger.js';

export interface ToolCallContext {
  camera: CameraInfo;
  store: StateStore;
  vision: VisionClient;
  cameraManager?: CameraManager;
}

export const toolDefinitions = [
  {
    name: 'fetch_snapshot',
    description: 'Fetches a fresh snapshot from the current camera and returns it as a base64 data URL.',
    parameters: {
      type: 'object',
      properties: {},
      additionalProperties: false
    }
  },
  {
    name: 'register_person',
    description: 'Stores a new known person face embedding with the provided name.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        embedding: {
          type: 'array',
          items: { type: 'number' }
        }
      },
      required: ['name', 'embedding'],
      additionalProperties: false
    }
  },
  {
    name: 'pan_tilt_zoom',
    description: 'Adjusts the camera PTZ orientation.',
    parameters: {
      type: 'object',
      properties: {
        pan: { type: 'number' },
        tilt: { type: 'number' },
        zoom: { type: 'number' }
      },
      additionalProperties: false
    }
  },
  {
    name: 'get_latest_detection',
    description: 'Returns the most recent detection summary for the current camera.',
    parameters: {
      type: 'object',
      properties: {},
      additionalProperties: false
    }
  }
];

export async function handleToolCall(name: string, args: any, context: ToolCallContext) {
  switch (name) {
    case 'fetch_snapshot':
      return context.vision.fetchSnapshot(context.camera);
    case 'register_person': {
      const person = await context.store.registerPerson({
        name: args.name,
        faceEmbedding: args.embedding
      });
      return person;
    }
    case 'pan_tilt_zoom':
      if (context.cameraManager) {
        await context.vision.controlPtz(context.camera, args);
      }
      return { status: 'ok' };
    case 'get_latest_detection':
      if (context.cameraManager) {
        const detection = context.cameraManager.getLatestDetection(context.camera.id);
        return detection ?? { status: 'no-data' };
      }
      return { status: 'no-camera-manager' };
    default:
      logger.warn('Unknown tool call %s', name);
      return { status: 'unknown_tool' };
  }
}
