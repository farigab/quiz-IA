const { generateSW } = require('workbox-build');
const path = require('node:path');

async function build() {
  try {
    const swDest = path.join(process.cwd(), 'service-worker.js');
    const { count, size, warnings } = await generateSW({
      swDest,
      globDirectory: process.cwd(),
      globPatterns: [
        'index.html',
        'styles.css',
        'app.js',
        'questions.json',
        'manifest.json',
        'icons/**/*.*'
      ],
      globIgnores: [
        'node_modules/**',
        'scripts/**',
        '.git/**',
        'package-lock.json'
      ],
      navigateFallback: '/index.html',
      navigateFallbackDenylist: [/^\/api\//],
      clientsClaim: true,
      skipWaiting: true,
      runtimeCaching: [
        {
          urlPattern: /\/api\//,
          handler: 'NetworkFirst',
          options: {
            cacheName: 'api-runtime-cache',
            networkTimeoutSeconds: 10,
            expiration: { maxEntries: 50, maxAgeSeconds: 24 * 60 * 60 },
            cacheableResponse: { statuses: [0, 200] }
          }
        },
        {
          urlPattern: /config\.js$/,
          handler: 'NetworkFirst',
          options: {
            cacheName: 'config-runtime-cache',
            expiration: { maxEntries: 5, maxAgeSeconds: 24 * 60 * 60 }
          }
        }
      ]
    });

    if (warnings?.length) {
      console.warn('Workbox warnings:');
      for (const w of warnings) console.warn(w);
    }

    console.log(`Generated ${count} files, total ${size} bytes, wrote ${swDest}`);
  } catch (err) {
    console.error('Error generating service worker:', err);
    process.exit(1);
  }
}

build();
