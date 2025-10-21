<template>
  <v-app>
    <v-app-bar app color="primary" dark>
      <v-app-bar-title>Guardian Admin</v-app-bar-title>
      <v-spacer></v-spacer>
      <v-btn :icon="'mdi-refresh'" @click="reload" :loading="loading"></v-btn>
    </v-app-bar>
    <v-main>
      <v-container fluid class="py-6">
        <v-row>
          <v-col cols="12" md="4">
            <CameraList />
          </v-col>
          <v-col cols="12" md="8">
            <LogList />
          </v-col>
        </v-row>
      </v-container>
    </v-main>
  </v-app>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useAdminStore } from './stores/admin';
import CameraList from './components/CameraList.vue';
import LogList from './components/LogList.vue';

const store = useAdminStore();
const loading = ref(false);

async function reload() {
  loading.value = true;
  try {
    await store.fetchState();
  } finally {
    loading.value = false;
  }
}

onMounted(async () => {
  await reload();
});
</script>
