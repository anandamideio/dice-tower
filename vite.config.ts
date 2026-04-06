import { defineConfig, loadEnv } from 'vite';
import wasm from 'vite-plugin-wasm';
import { viteStaticCopy } from 'vite-plugin-static-copy';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const foundryProxyTarget = env.FOUNDRY_PROXY_TARGET;
  const workerPlugins: import('vite').PluginOption[] = [
    wasm() as unknown as import('vite').PluginOption
  ];

  return {
    plugins: [
      wasm(),
      viteStaticCopy({
        targets: [
          { src: 'module.json', dest: '.' },
          { src: 'assets', dest: '.' }
        ]
      })
    ],
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      sourcemap: true,
      target: 'esnext',
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
    optimizeDeps: {
      exclude: ['@dimforge/rapier3d']
    },
    worker: {
      format: 'es',
      target: 'esnext',
      plugins: () => workerPlugins
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
