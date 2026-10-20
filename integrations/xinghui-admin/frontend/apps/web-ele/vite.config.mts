import { defineConfig } from '@vben/vite-config';

import ElementPlus from 'unplugin-element-plus/vite';
import Components from 'unplugin-vue-components/vite';
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers';

export default defineConfig(async () => {
  return {
    application: {},
    vite: {
      plugins: [
        ElementPlus({
          format: 'esm',
        }),
        Components({
          resolvers: [ElementPlusResolver()],
          dts: 'src/components.d.ts',
        }),
      ],
      server: {
        proxy: {
          '/api': {
            changeOrigin: true,
            rewrite: (path) => path.replace(/^\/api/, ''),
            // Spring Boot backend
            target: process.env.ADMIN_API_PROXY_TARGET || 'http://127.0.0.1:18080',
            ws: true,
          },
        },
      },
    },
  };
});
