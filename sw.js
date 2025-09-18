const CACHE = 'frogpond-v3';
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
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)));
});
self.addEventListener('activate', (e)=>{
  e.waitUntil(Promise.all([
    caches.keys().then(keys=>Promise.all(keys.map(k=>k!==CACHE && caches.delete(k)))),
    self.clients.claim()
  ]));
});
self.addEventListener('fetch', (e)=>{
  const req = e.request;
  // runtime cache for audio
  if (req.destination === 'audio' || req.url.endsWith('.mp3')) {
    e.respondWith(
      caches.open(CACHE).then(async cache=>{
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        cache.put(req, res.clone());
        return res;
      })
    );
    return;
  }
  // shell: cache first
  e.respondWith(caches.match(req).then(r=>r || fetch(req)));
});
