import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiTarget = env.VITE_API_PROXY_TARGET || 'http://127.0.0.1:3001';
  const devHost = env.VITE_DEV_HOST || '127.0.0.1';

  return {
    plugins: [react()],
    server: {
      host: devHost,
      port: Number(env.VITE_DEV_PORT) || 3000,
      // Bind loopback by default. LAN bind: VITE_DEV_HOST=0.0.0.0 (patched Vite 6.4.3+ fs.deny).
      fs: {
        deny: ['.env', '.env.*', '**/.env', '**/.env.*', '**/*.{crt,pem}'],
      },
      proxy: {
        '/api': {
          target: apiTarget,
          changeOrigin: true,
        },
      },
    },
  };
});
