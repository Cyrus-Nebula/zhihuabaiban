/* 智绘几何 · v4 离线壳层
 * 只缓存同源静态资源；API / 跨域请求一律不缓存。
 */
const CACHE = 'geora-shell-v4-1';
const SHELL = [
  '/',
  '/index.html',
  '/favicon.svg',
  '/apple-touch-icon.png',
  '/css/app.css?v=v4a',
  '/css/style.css',
  '/css/unslop.css',
  '/css/site-improve.css',
  '/css/redesign.css?v=ico1',
  '/css/board-ui.css?v=bui1',
  '/css/pages.css?v=n1',
  '/js/config.js',
  '/js/store.js',
  '/js/models.js',
  '/js/auth.js',
  '/js/templates.js',
  '/js/landing.js',
  '/js/workbench.js',
  '/js/page-shell.js',
  '/vendor/jsxgraphcore.js',
  '/vendor/jsxgraph.css',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL).catch(() => undefined)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() => caches.match('/index.html'))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res && res.status === 200 && res.type === 'basic') {
        const copy = res.clone();
        caches.open(CACHE).then((cache) => cache.put(req, copy));
      }
      return res;
    }))
  );
});
