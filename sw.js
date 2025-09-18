const CACHE = 'frogpod-v3';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './main.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (e)=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)));
});
self.addEventListener('activate', (e)=>{
  e.waitUntil(caches.keys().then(keys=>Promise.all(keys.map(k=>k!==CACHE && caches.delete(k)))));
});
self.addEventListener('fetch', (e)=>{
  const req = e.request;
  // runtime cache for audio files
  if (req.destination === 'audio' || req.url.endsWith('.mp3')) {
    e.respondWith(
      caches.open(CACHE).then(async cache => {
        const cached = await cache.match(req);
        if (cached) return cached;
        try {
          const res = await fetch(req);
          cache.put(req, res.clone());
          return res;
        } catch (err) {
          return fetch(req); // fallback
        }
      })
    );
    return;
  }
  // default: cache-first for app shell
  e.respondWith(caches.match(req).then(r => r || fetch(req)));
});
