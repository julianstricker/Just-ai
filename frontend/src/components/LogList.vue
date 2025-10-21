<template>
  <v-card>
    <v-card-title>Event Logs</v-card-title>
    <v-divider></v-divider>
    <v-data-table
      :headers="headers"
      :items="logs"
      :items-per-page="10"
      density="comfortable"
    >
      <template #item.level="{ value }">
        <v-chip :color="levelColor(value)" size="small" class="text-white">{{ value }}</v-chip>
      </template>
      <template #item.createdAt="{ value }">
        {{ formatDate(value) }}
      </template>
    </v-data-table>
  </v-card>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useAdminStore } from '../stores/admin';

const store = useAdminStore();

const headers = [
  { title: 'Level', key: 'level', sortable: false },
  { title: 'Message', key: 'message', sortable: false },
  { title: 'Timestamp', key: 'createdAt', sortable: false }
];

const logs = computed(() => store.state?.logs ?? []);

function levelColor(level: string) {
  switch (level) {
    case 'alarm':
      return 'red';
    case 'error':
      return 'orange';
    case 'warn':
      return 'amber';
    default:
      return 'green';
  }
}

function formatDate(value: string) {
  return new Date(value).toLocaleString();
}
</script>
