// Offline cache: every app file is cached on install, then served cache-first.
const VERSION = 'heicflip-v1.1.0';
const FILES = [
  './', 'index.html', 'privacy.html', 'styles.css', 'manifest.webmanifest',
  'js/app.js', 'js/ui.js', 'js/icons.js', 'js/convert.js', 'js/exif.js', 'js/zip.js', 'js/support.js', 'js/gate.js',
  'vendor/heic-to.js', 'vendor/heic-to-LICENSE.txt',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png',
];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return; // ads etc. go straight to the network
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then(hit => hit || fetch(req).then(res => {
      if (res.ok && res.type === 'basic') { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => req.mode === 'navigate' ? caches.match('index.html') : Response.error()))
  );
});
