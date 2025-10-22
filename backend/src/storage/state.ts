import fs from 'fs/promises';
import path from 'path';
import { EventEmitter } from 'eventemitter3';
import { v4 as uuid } from 'uuid';

export interface KnownPerson {
  id: string;
  name: string;
  faceEmbedding: number[];
  lastSeenAt?: string;
  lastSeenCameraId?: string;
}

export interface CameraInfo {
  id: string;
  name: string;
  host: string;
  port?: number;
  rtspUrl?: string;
  rtspAudioUrl?: string;
  talkRtspUrl?: string;
  username?: string;
  password?: string;
  profileToken?: string;
  audioSupported?: boolean;
  lastSnapshotUrl?: string;
}

export interface LogEntry {
  id: string;
  level: 'info' | 'warn' | 'error' | 'alarm';
  message: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export interface AppState {
  people: KnownPerson[];
  cameras: CameraInfo[];
  logs: LogEntry[];
}

export class StateStore extends EventEmitter {
  private state: AppState = { people: [], cameras: [], logs: [] };
  constructor(private readonly filePath: string) {
    super();
  }

  async init() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    try {
      const raw = await fs.readFile(this.filePath, 'utf-8');
      this.state = JSON.parse(raw) as AppState;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        await this.persist();
      } else {
        throw err;
      }
    }
  }

  get snapshot(): AppState {
    return JSON.parse(JSON.stringify(this.state));
  }

  async persist() {
    await fs.writeFile(this.filePath, JSON.stringify(this.state, null, 2));
  }

  async addLog(entry: Omit<LogEntry, 'id' | 'createdAt'>) {
    const logEntry: LogEntry = {
      id: uuid(),
      createdAt: new Date().toISOString(),
      ...entry
    };
    this.state.logs.unshift(logEntry);
    this.state.logs = this.state.logs.slice(0, 5000);
    await this.persist();
    this.emit('log', logEntry);
    return logEntry;
  }

  async upsertCamera(camera: CameraInfo) {
    if (!camera.id) {
      throw new Error('Camera id is required');
    }
    const existingIndex = this.state.cameras.findIndex((c) => c.id === camera.id);
    if (existingIndex >= 0) {
      this.state.cameras[existingIndex] = camera;
    } else {
      this.state.cameras.push(camera);
    }
    await this.persist();
    this.emit('camera', camera);
  }

  async removeCamera(id: string) {
    this.state.cameras = this.state.cameras.filter((c) => c.id !== id);
    await this.persist();
    this.emit('cameraRemoved', id);
  }

  async registerPerson(person: Omit<KnownPerson, 'id'>) {
    const existing = this.state.people.find((p) => p.name.toLowerCase() === person.name.toLowerCase());
    if (existing) {
      existing.faceEmbedding = person.faceEmbedding;
      await this.persist();
      this.emit('person', existing);
      return existing;
    }
    const created: KnownPerson = { ...person, id: uuid() };
    this.state.people.push(created);
    await this.persist();
    this.emit('person', created);
    return created;
  }

  async updateLastSeen(personId: string, cameraId: string) {
    const person = this.state.people.find((p) => p.id === personId);
    if (!person) return;
    person.lastSeenAt = new Date().toISOString();
    person.lastSeenCameraId = cameraId;
    await this.persist();
    this.emit('person', person);
  }
}
