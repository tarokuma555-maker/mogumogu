const CACHE_NAME = 'mogumogu-v1';
const RUNTIME_CACHE = 'mogumogu-runtime-v1';

// 初期キャッシュ（CRAのハッシュ付きファイルはランタイムで対応）
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/logo192.png',
  '/logo512.png',
  '/manifest.json',
];

// Install: 静的アセットをキャッシュ
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_URLS).catch((err) => {
        console.warn('[SW] Precache failed:', err);
      });
    })
  );
  self.skipWaiting();
});

// Activate: 古いキャッシュを削除
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) => {
      return Promise.all(
        names
          .filter((n) => n !== CACHE_NAME && n !== RUNTIME_CACHE)
          .map((n) => caches.delete(n))
      );
    })
  );
  self.clients.claim();
});

// Fetch: キャッシュ戦略
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== 'GET') return;
  if (!url.protocol.startsWith('http')) return;

  // 静的アセット: Cache-first
  if (
    url.pathname.startsWith('/static/') ||
    url.pathname.match(/\.(js|css|png|jpg|jpeg|svg|gif|woff2|woff|ttf|ico)$/)
  ) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((res) => {
          if (res && res.status === 200) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((c) => c.put(request, clone));
          }
          return res;
        });
      })
    );
    return;
  }

  // Supabase API: Network-first + キャッシュフォールバック
  if (url.hostname.includes('supabase.co')) {
    event.respondWith(
      fetch(request)
        .then((res) => {
          if (res && res.status === 200) {
            const clone = res.clone();
            caches.open(RUNTIME_CACHE).then((c) => c.put(request, clone));
          }
          return res;
        })
        .catch(() => {
          return caches.match(request).then((cached) => {
            if (cached) return cached;
            return new Response(
              JSON.stringify({ error: 'Offline', offline: true }),
              { headers: { 'Content-Type': 'application/json' } }
            );
          });
        })
    );
    return;
  }

  // HTML: Network-first
  if (request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(request, clone));
          return res;
        })
        .catch(() => {
          return caches.match(request).then((cached) => {
            return cached || caches.match('/index.html');
          });
        })
    );
    return;
  }

  // その他: Network-first
  event.respondWith(
    fetch(request).catch(() => caches.match(request))
  );
});

// Background Sync: オフラインコメント送信
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-comments') {
    event.waitUntil(syncPendingComments());
  }
});

async function syncPendingComments() {
  // 将来の実装: IndexedDB から保留コメントを取得して送信
  console.log('[SW] Background sync: comments');
}

// クライアントからのメッセージ処理
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
