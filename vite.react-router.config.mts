import { reactRouter } from '@react-router/dev/vite'
import { defineConfig } from 'vite'

export default defineConfig(async () => {
  const { default: tailwindcss } = await import('@tailwindcss/vite')

  return {
    plugins: [tailwindcss(), reactRouter()],
    publicDir: 'public',
    server: {
      host: '127.0.0.1',
      port: 4173,
    },
  }
})
