import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import 'vuetify/styles';
import '@mdi/font/css/materialdesignicons.css';
import { createVuetify } from 'vuetify';
import * as components from 'vuetify/components';
import * as labsComponents from 'vuetify/labs/components';

const vuetify = createVuetify({
  components: {
    ...components,
    ...labsComponents
  }
});

createApp(App).use(createPinia()).use(vuetify).mount('#app');
