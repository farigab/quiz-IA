const { generateSW } = require('workbox-build');
const path = require('node:path');
const fs = require('node:fs');
const { execSync } = require('node:child_process');

async function build() {
  try {
    // Garantir que `public/config.js` receba um `buildId` novo em cada build.
    // Assim o cliente regista o service-worker com `?v=<buildId>` e força
    // a atualização do SW + precache do browser.
    try {
      execSync('node scripts/generate-config.js', { stdio: 'inherit' });
    } catch (err) {
      console.warn('generate-config.js falhou, prosseguindo:', err?.message || err);
    }
    const publicDir = path.join(process.cwd(), 'public');

    // Read generated config.js to find the per-build service worker filename.
    let swDest;
    try {
      const cfg = fs.readFileSync(path.join(publicDir, 'config.js'), 'utf8');
      const m = cfg.match(/globalThis\.SHOWDO_CONFIG\.serviceWorkerFile\s*=\s*(['"])(.*?)\1/);
      if (m && m[2]) {
        swDest = path.join(publicDir, m[2]);
      }
    } catch (err) {
      // fall back to default
    }
    if (!swDest) swDest = path.join(publicDir, 'service-worker.js');
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
