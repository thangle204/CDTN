import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { DEV_WORKSPACE_HEADER, devWorkspaceId } from '../backend/utils/devWorkspace.js'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'API_');
  return {
  plugins: [react()],
  server: {
    headers: { [DEV_WORKSPACE_HEADER]: devWorkspaceId },
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: env.API_PROXY_TARGET || 'http://localhost:5000',
        changeOrigin: true,
        secure: false,
      },
      '/uploads': {
        target: env.API_PROXY_TARGET || 'http://localhost:5000',
        changeOrigin: true,
        secure: false,
      },
    },
  },
  };
})
