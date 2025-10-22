import { defineStore } from 'pinia';
import axios from 'axios';
import { createApiUrl } from '../config/api';

interface KnownPerson {
  id: string;
  name: string;
  lastSeenAt?: string;
  lastSeenCameraId?: string;
}

interface CameraInfo {
  id: string;
  name: string;
  host: string;
  port?: number;
  rtspUrl?: string;
  username?: string;
  password?: string;
  audioSupported?: boolean;
  lastSnapshotUrl?: string;
}

interface LogEntry {
  id: string;
  level: 'info' | 'warn' | 'error' | 'alarm';
  message: string;
  createdAt: string;
}

interface DiscoveredCamera {
  name: string;
  hostname: string;
  port: number;
  hardware: string;
  address: string;
  urn: string;
}

interface AdminState {
  people: KnownPerson[];
  cameras: CameraInfo[];
  logs: LogEntry[];
}

export const useAdminStore = defineStore('admin', {
  state: () => ({
    state: null as AdminState | null,
    discoveredCameras: [] as DiscoveredCamera[]
  }),
  actions: {
    async fetchState() {
      const response = await axios.get<AdminState>(createApiUrl('/admin/state'));
      this.state = response.data;
    },
    async addCamera(camera: CameraInfo) {
      await axios.post(createApiUrl('/admin/cameras'), camera);
      await this.fetchState();
    },
    async removeCamera(id: string) {
      await axios.delete(createApiUrl(`/admin/cameras/${id}`));
      await this.fetchState();
    },
    async discoverCameras(timeout = 10000): Promise<DiscoveredCamera[]> {
      try {
        const response = await axios.get<DiscoveredCamera[]>(createApiUrl('/admin/cameras/discover'), {
          params: { timeout }
        });
        this.discoveredCameras = response.data;
        return response.data;
      } catch (error) {
        console.error('Failed to discover cameras:', error);
        return [];
      }
    },
    async fetchLatestDetection(cameraId: string) {
      const response = await axios.get(createApiUrl(`/admin/cameras/${cameraId}/latest-detection`));
      return response.data as any;
    }
  }
});
