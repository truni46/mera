import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import checker from 'vite-plugin-checker'

export default defineConfig({
    plugins: [
        react(),
        checker({ typescript: true }),
    ],
    build: {
        sourcemap: false,
        minify: 'esbuild',
        rollupOptions: {
            output: {
                entryFileNames: 'assets/[name]-[hash].js',
                chunkFileNames: 'assets/[name]-[hash].js',
                assetFileNames: 'assets/[name]-[hash][extname]',
            },
        },
    },
    server: {
        port: 5173,
        proxy: {
            '/api/v1': {
                target: 'http://localhost:3000',
                changeOrigin: true
            }
        }
    }
})
