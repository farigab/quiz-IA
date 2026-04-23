const { generateSW } = require('workbox-build');
const path = require('node:path');

async function build() {
  try {
    const publicDir = path.join(process.cwd(), 'public');
    const swDest = path.join(publicDir, 'service-worker.js');
    const { count, size, warnings } = await generateSW({
      swDest,
      globDirectory: publicDir,

      // 1. MODIFICADO: Agora pegamos CSS, JS e HTML dinamicamente para o precache
      globPatterns: [
        '**/*.{html,css,js,json}',
        'icons/**/*.*'
      ],
      globIgnores: [
        'service-worker.js', // IMPORTANTE: Impede que o SW faça cache dele mesmo
        'node_modules/**',
        'scripts/**',
        '.git/**',
        'package-lock.json'
      ],
      navigateFallback: '/index.html',
      navigateFallbackDenylist: [/^\/api\//],
      clientsClaim: true,
      skipWaiting: true,

      // 2. MODIFICADO: Removemos o app.js e styles.css daqui, pois agora
      // eles estão no precache (globPatterns) e serão versionados automaticamente.
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
