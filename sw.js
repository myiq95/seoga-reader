/* 서재 · 서비스 워커 (오프라인 지원)
 * 배포할 때마다 CACHE 값을 올려 주세요. 올리면 기기가 새 버전을 받아요. */
const CACHE = 'seoga-reader-v1.2.1';
const SCOPE = self.registration.scope;

const SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.json',
  './apple-touch-icon-v2.png',
  './icons/icon-192.png',
  './icons/icon-512.png'
].map((p) => new URL(p, SCOPE).href);

// PDF 엔진과 한글 CMap 표 (pdfjs-dist 패키지를 jsDelivr에서 받습니다)
const PDFJS = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174';
const KOREAN_CMAPS = ['UniKS-UCS2-H', 'UniKS-UTF16-H', 'KSC-EUC-H', 'KSC-H', 'KSCms-UHC-H', 'KSCms-UHC-HW-H', 'KSCpc-EUC-H'];
const LIBS = [
  'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
  `${PDFJS}/build/pdf.min.js`,
  `${PDFJS}/build/pdf.worker.min.js`,
  ...KOREAN_CMAPS.map((name) => `${PDFJS}/cmaps/${name}.bcmap`)
];

// 외부 글꼴과 라이브러리는 처음 쓸 때 캐시합니다. (글꼴 전체를 미리 받으면 용량이 너무 커져요)
const CDN_HOSTS = ['cdnjs.cloudflare.com', 'cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(SHELL);
    // 라이브러리는 일부가 실패해도 설치를 막지 않습니다.
    await Promise.allSettled(LIBS.map(async (url) => {
      const res = await fetch(url, { mode: 'cors' });
      if (res.ok) await cache.put(url, res);
    }));
  })());
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key !== CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin === self.location.origin) {
    event.respondWith(networkFirst(req));
  } else if (CDN_HOSTS.includes(url.hostname)) {
    event.respondWith(cacheFirst(req));
  }
});

// 내 파일: 온라인이면 최신본을 받아 캐시를 갱신하고, 오프라인이면 캐시를 씁니다.
async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch (_) {
    const hit = (await cache.match(req, { ignoreSearch: true })) ||
                (await cache.match(new URL('./index.html', SCOPE).href));
    return hit || new Response('오프라인 상태이고 캐시에 없는 파일이에요.', { status: 503 });
  }
}

// 외부 자원: 한 번 받은 것은 캐시에서 바로 씁니다.
async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone());
  return res;
}
