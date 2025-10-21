<template>
  <v-card>
    <v-card-title>
      Cameras
      <v-spacer></v-spacer>
      <v-btn :icon="'mdi-plus'" size="small" @click="openDialog = true"></v-btn>
    </v-card-title>
    <v-divider></v-divider>
    <v-list density="compact">
      <v-list-item v-for="camera in cameras" :key="camera.id">
        <v-list-item-title>{{ camera.name }}</v-list-item-title>
        <v-list-item-subtitle>
          {{ camera.host }}
          <span v-if="camera.lastSnapshotUrl" class="ml-2">(Snapshot cached)</span>
        </v-list-item-subtitle>
        <template #append>
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
</template>

<script setup lang="ts">
import { reactive, ref, computed } from 'vue';
import { useAdminStore } from '../stores/admin';

const store = useAdminStore();
const openDialog = ref(false);
const form = reactive({
  name: '',
  host: '',
  username: '',
  password: ''
});

const cameras = computed(() => store.state?.cameras ?? []);

async function save() {
  await store.addCamera({ ...form, id: crypto.randomUUID() });
  openDialog.value = false;
  form.name = '';
  form.host = '';
  form.username = '';
  form.password = '';
}

async function remove(id: string) {
  await store.removeCamera(id);
}
</script>
