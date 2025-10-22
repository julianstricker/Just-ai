import { defineConfig, loadEnv } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  
  return {
    plugins: [vue()],
    server: {
      host: '0.0.0.0',
      port: 5173,
      proxy: {
        '/admin': {
          target: env.VITE_API_BASE_URL || 'http://localhost:8080',
          changeOrigin: true,
          secure: false
        }
      }
    }
  };
});
