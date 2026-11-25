// 2026-11-16 待辦 2f（老闆選 B）：平板斷網時重新整理／Fully 當掉重開／平板重開機，收銀頁也打得開
// 部署成 pos_offline_sw.js，跟 tablet.html 放同一層；只有平板收銀頁會登記它，顧客的點餐頁不會有
// 只管兩個頁面檔：平板收銀頁(tablet.html)、出單模組(print_tablet_fully.html)；
//   其他請求(送單、讀資料、出單機 https://IP、點餐頁、後台)一律不碰，照原本直接上網
// 做法：有網路一律抓最新版，抓到就存一份；抓不到(斷網)或 8 秒沒回應，才拿存的那份
//   → 有網路時永遠是最新版(部署後不會卡舊版)；存的那份會在頁面裡標記「從存的那份打開」，平板一開機就直接進離線模式
const CACHE = 'abao-pos-pages-v1';
const PAGES = ['tablet.html', 'print_tablet_fully.html'];
const WAIT_MS = 8000;
const MARK = '<script>window.__ABAO_PAGE_FROM_CACHE__=1</script>';

function pageOf_(url) {
  const u = new URL(url);
  if (u.origin !== self.location.origin) return '';
  const base = new URL('./', self.location.href).pathname;
  if (!u.pathname.startsWith(base)) return '';
  const name = u.pathname.slice(base.length);
  return PAGES.includes(name) ? name : '';
}
function cached_(name) {
  return caches.open(CACHE).then(c => c.match(name)).then(r => r ? r.text().then(t => new Response(
    t.replace(/<head(\s[^>]*)?>/i, m => m + MARK), { headers: { 'Content-Type': 'text/html; charset=utf-8' } })) : null);
}

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(PAGES.map(p =>
    fetch(p, { cache: 'no-store' }).then(r => { if (r.ok) return c.put(p, r); }).catch(() => {})))));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k.startsWith('abao-pos-pages-') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const name = pageOf_(req.url);
  if (!name) return;   // 不是那兩個頁面：不攔，瀏覽器照原本上網
  e.respondWith(new Promise(resolve => {
    let done = false;
    const finish = r => { if (!done && r) { done = true; resolve(r); } };
    const timer = setTimeout(() => { cached_(name).then(finish); }, WAIT_MS);   // 網路卡住：有存的就先用存的
    fetch(req.url, { cache: 'no-store', credentials: 'same-origin' }).then(r => {
      clearTimeout(timer);
      if (r.ok) {
        const copy = r.clone();   // 要在交給頁面之前先複製(頁面開始讀之後就複製不了)
        const save = caches.open(CACHE).then(c => c.put(name, copy)).catch(() => {});
        try { e.waitUntil(save); } catch (x) {}   // 已經先用存的那份回應了：照樣更新存的版本
        finish(r);
      } else {
        cached_(name).then(c => finish(c || r));   // 伺服器出錯：有存的用存的
      }
    }).catch(err => {
      clearTimeout(timer);
      cached_(name).then(c => { if (c) finish(c); else if (!done) { done = true; resolve(Response.error()); } });
    });
  }));
});
