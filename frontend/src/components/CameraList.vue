<template>
  <v-card>
    <v-card-title>
      Kameras
      <v-spacer></v-spacer>
      <v-btn 
        :icon="'mdi-magnify'" 
        size="small" 
        :loading="discovering"
        @click="discover"
        title="ONVIF Kameras suchen"
      ></v-btn>
      <v-btn :icon="'mdi-plus'" size="small" @click="openDialog = true" class="ml-2"></v-btn>
    </v-card-title>
    <v-divider></v-divider>
    
    <!-- Discovered cameras section -->
    <div v-if="discoveredCameras.length > 0">
      <v-card-subtitle class="text-primary">Gefundene ONVIF Kameras</v-card-subtitle>
      <v-list density="compact">
        <v-list-item v-for="discoveredCamera in discoveredCameras" :key="discoveredCamera.urn">
          <v-list-item-title>{{ discoveredCamera.name }}</v-list-item-title>
          <v-list-item-subtitle>
            {{ discoveredCamera.hostname }}:{{ discoveredCamera.port }} ({{ discoveredCamera.hardware }})
          </v-list-item-subtitle>
          <template #append>
            <v-btn 
              :icon="'mdi-plus'" 
              variant="text" 
              size="small" 
              @click="addDiscoveredCamera(discoveredCamera)"
              title="Kamera hinzufügen"
            ></v-btn>
          </template>
        </v-list-item>
      </v-list>
      <v-divider></v-divider>
    </div>

    <!-- Configured cameras section -->
    <div v-if="cameras.length > 0">
      <v-card-subtitle class="text-primary">Konfigurierte Kameras</v-card-subtitle>
    </div>
    <v-list density="compact">
      <v-list-item v-for="camera in cameras" :key="camera.id">
        <v-list-item-title>{{ camera.name }}</v-list-item-title>
        <v-list-item-subtitle>
          {{ camera.host }}
          <span v-if="camera.lastSnapshotUrl" class="ml-2">(Snapshot cached)</span>
        </v-list-item-subtitle>
        <template #append>
          <v-btn :icon="'mdi-eye'" variant="text" size="small" @click="view(camera)"></v-btn>
          <v-btn :icon="'mdi-delete'" variant="text" size="small" @click="remove(camera.id)"></v-btn>
        </template>
      </v-list-item>
    </v-list>
  </v-card>

  <v-dialog v-model="openDialog" width="500">
    <v-card>
      <v-card-title>Add Camera</v-card-title>
      <v-card-text>
        <v-text-field v-model="form.name" label="Name"></v-text-field>
        <v-text-field v-model="form.host" label="Hostname"></v-text-field>
        <v-text-field v-model.number="form.port" label="Port" type="number"></v-text-field>
        <v-text-field v-model="form.rtspUrl" label="RTSP URL (optional)"></v-text-field>
        <v-text-field v-model="form.username" label="Username"></v-text-field>
        <v-text-field v-model="form.password" label="Password" type="password"></v-text-field>
      </v-card-text>
      <v-card-actions>
        <v-spacer></v-spacer>
        <v-btn text @click="openDialog = false">Cancel</v-btn>
        <v-btn color="primary" @click="save">Save</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>

  <v-dialog v-model="viewDialog" max-width="900">
    <v-card>
      <v-card-title>Preview</v-card-title>
      <v-card-text>
        <div v-if="currentCamera">
          <div style="position: relative; display: inline-block;">
            <img :src="liveUrl(currentCamera.id)" @error="onLiveError" style="max-width: 100%; display: block;" ref="liveImg" @load="onLiveLoad" />
            <div :style="overlayStyle">
              <template v-if="preview?.objects">
                <div v-for="(obj, idx) in preview.objects" :key="idx" :style="bboxStyle(obj.bbox)">
                  <span class="badge">{{ obj.label }} {{ (obj.confidence*100).toFixed(0) }}%</span>
                </div>
              </template>
            </div>
          </div>
        </div>
      </v-card-text>
      <v-card-actions>
        <v-spacer></v-spacer>
        <v-btn text @click="viewDialog = false">Close</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { reactive, ref, computed, watch, onUnmounted } from 'vue';
import { useAdminStore } from '../stores/admin';
import { createApiUrl } from '../config/api';

interface DiscoveredCamera {
  name: string;
  hostname: string;
  port: number;
  hardware: string;
  address: string;
  urn: string;
}

const store = useAdminStore();
const openDialog = ref(false);
const viewDialog = ref(false);
const discovering = ref(false);
const preview = ref<any | null>(null);
const currentCamera = ref<any | null>(null);
const liveImg = ref<HTMLImageElement | null>(null);
const naturalSize = ref({ w: 0, h: 0 });
const renderedSize = ref({ w: 0, h: 0 });
const overlayStyle = computed(() => ({
  position: 'absolute',
  inset: 0,
  pointerEvents: 'none',
  zIndex: 2,
} as any));
const form = reactive({
  name: '',
  host: '',
  port: 80,
  rtspUrl: '',
  username: '',
  password: ''
});

const cameras = computed(() => store.state?.cameras ?? []);
const discoveredCameras = computed(() => store.discoveredCameras);

async function discover() {
  discovering.value = true;
  try {
    await store.discoverCameras(10000);
  } finally {
    discovering.value = false;
  }
}

async function addDiscoveredCamera(discoveredCamera: DiscoveredCamera) {
  // Pre-fill the form with discovered camera data
  form.name = discoveredCamera.name;
  form.host = discoveredCamera.hostname;
  // Prefer ONVIF control on HTTP port 80 as per example4.js
  form.port = 80;
  // Leave username and password empty for user to fill
  form.username = '';
  form.password = '';
  openDialog.value = true;
}

async function save() {
  await store.addCamera({ ...form, id: crypto.randomUUID() });
  openDialog.value = false;
  form.name = '';
  form.host = '';
  form.port = 80;
  form.rtspUrl = '';
  form.username = '';
  form.password = '';
}

async function remove(id: string) {
  await store.removeCamera(id);
}

function bboxStyle(bbox: [number, number, number, number]) {
  const [l, t, r, b] = bbox;
  const width = r - l;
  const height = b - t;
  // Scale to rendered size if natural size known
  const ns = naturalSize.value;
  const rs = renderedSize.value;
  const scaleX = ns.w && rs.w ? rs.w / ns.w : 1;
  const scaleY = ns.h && rs.h ? rs.h / ns.h : 1;
  return {
    position: 'absolute',
    left: `${l * scaleX}px`,
    top: `${t * scaleY}px`,
    width: `${width * scaleX}px`,
    height: `${height * scaleY}px`,
    border: '2px solid #00e5ff',
    boxSizing: 'border-box',
    color: '#fff',
    fontSize: '12px',
  } as any;
}

async function view(camera: any) {
  currentCamera.value = camera;
  viewDialog.value = true;
  try {
    preview.value = await store.fetchLatestDetection(camera.id);
    if (!preview.value && camera.lastSnapshotUrl) {
      preview.value = { snapshotDataUrl: camera.lastSnapshotUrl, objects: [] };
    }
  } catch (e) {
    preview.value = { snapshotDataUrl: camera.lastSnapshotUrl, objects: [] };
  }
  startPolling();
}

function liveUrl(cameraId: string) {
  return createApiUrl(`/admin/cameras/${cameraId}/live.mjpg`);
}

function onLiveLoad() {
  const img = liveImg.value;
  if (!img) return;
  naturalSize.value = { w: img.naturalWidth, h: img.naturalHeight };
  // After render, read client size
  requestAnimationFrame(() => {
    renderedSize.value = { w: img.clientWidth, h: img.clientHeight };
  });
}

function onLiveError() {
  if (!currentCamera.value) return;
  // Fallback to a single snapshot if MJPEG stream fails
  (liveImg.value as HTMLImageElement).src = createApiUrl(`/admin/cameras/${currentCamera.value.id}/snapshot.jpg`);
}

let pollTimer: any = null;
function startPolling() {
  stopPolling();
  pollTimer = setInterval(async () => {
    try {
      if (!currentCamera.value) return;
      const data = await store.fetchLatestDetection(currentCamera.value.id);
      if (data) preview.value = data;
    } catch {}
  }, 1500);
}
function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

watch(viewDialog, (open) => {
  if (!open) {
    stopPolling();
  }
});

onUnmounted(() => stopPolling());
</script>
