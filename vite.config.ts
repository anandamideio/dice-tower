import { defineConfig, loadEnv } from 'vite';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';
import { viteStaticCopy } from 'vite-plugin-static-copy';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const foundryProxyTarget = env.FOUNDRY_PROXY_TARGET;

  return {
    plugins: [
      wasm(),
      topLevelAwait(),
      viteStaticCopy({
        targets: [
          { src: 'module.json', dest: '.' },
          { src: 'assets/**/*', dest: 'assets' }
        ]
      })
    ],
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      sourcemap: true,
      rollupOptions: {
        input: 'src/main.ts',
        output: {
          format: 'es',
          entryFileNames: 'main.js',
          chunkFileNames: 'chunks/[name]-[hash].js',
          assetFileNames: 'assets/[name]-[hash][extname]'
        }
      }
    },
    server: {
      host: '0.0.0.0',
      port: 5173,
      strictPort: true,
      proxy: foundryProxyTarget
        ? {
            '/socket.io': {
              target: foundryProxyTarget,
              changeOrigin: true,
              ws: true
            },
            '/game': {
              target: foundryProxyTarget,
              changeOrigin: true
            },
            '/modules': {
              target: foundryProxyTarget,
              changeOrigin: true
            }
          }
        : undefined
    }
  };
});
