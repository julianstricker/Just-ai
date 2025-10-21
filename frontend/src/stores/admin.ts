import { defineStore } from 'pinia';
import axios from 'axios';

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

interface AdminState {
  people: KnownPerson[];
  cameras: CameraInfo[];
  logs: LogEntry[];
}

export const useAdminStore = defineStore('admin', {
  state: () => ({
    state: null as AdminState | null
  }),
  actions: {
    async fetchState() {
      const response = await axios.get<AdminState>('/admin/state');
      this.state = response.data;
    },
    async addCamera(camera: CameraInfo) {
      await axios.post('/admin/cameras', camera);
      await this.fetchState();
    },
    async removeCamera(id: string) {
      await axios.delete(`/admin/cameras/${id}`);
      await this.fetchState();
    }
  }
});
