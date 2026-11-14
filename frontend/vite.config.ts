/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv } from 'vite'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))

export default defineConfig(({ mode }) => {
  // Only the Matterport SDK (application) key reaches the browser. It is domain-restricted by
  // Matterport and meant for client use. The Model API key/token stay server-side: the prefix
  // filter below loads nothing else from the root .env.
  const env = loadEnv(mode, repoRoot, ['MATTERPORT_SDK_KEY', 'VITE_MATTERPORT_SDK_KEY'])
  const sdkKey = env.VITE_MATTERPORT_SDK_KEY || env.MATTERPORT_SDK_KEY || ''
  return {
    plugins: [react(), tailwindcss()],
    define: {
      'import.meta.env.VITE_MATTERPORT_SDK_KEY': JSON.stringify(sdkKey),
    },
    server: {
      proxy: {
        '/api': {
          target: process.env.REVERB_API ?? 'http://localhost:8000',
          rewrite: (path) => path.replace(/^\/api/, ''),
        },
      },
    },
    test: {
      include: ['src/**/*.test.ts'],
    },
  }
})
