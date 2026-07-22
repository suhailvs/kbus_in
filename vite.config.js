// vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'dev-multi-page-routing',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url === '/' || req.url === '/index.html') {
            return next(); // serve static index.html as-is
          }

          // Any other path (e.g. /map, /map/123) → serve app.html
          if (
            !req.url?.startsWith('/@') &&      // skip vite internals
            !req.url?.startsWith('/src/') &&    // skip module requests
            !req.url?.includes('.') &&          // skip asset requests (.js, .css, .png etc)
            req.url !== '/app.html'
          ) {
            req.url = '/app.html';
          }

          next();
        });
      },
    },
  ],
  build: {
    rollupOptions: {
      input: {
        home: 'index.html',
        app: 'app.html',
      },
    },
  },
});