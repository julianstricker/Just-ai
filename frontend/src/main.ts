import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import 'vuetify/styles';
import '@mdi/font/css/materialdesignicons.css';
import { createVuetify } from 'vuetify';
import { VDataTable } from 'vuetify/labs/VDataTable';

const vuetify = createVuetify({
  components: {
    VDataTable
  }
});

createApp(App).use(createPinia()).use(vuetify).mount('#app');
