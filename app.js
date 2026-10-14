/* 서재 · 독서 PWA · app.js
 * txt · docx · pdf · epub · md · html 읽기 / 서재 / 이어 읽기 / 시스템 TTS / 오프라인 */
(() => {
  'use strict';

  /* ================= 유틸 ================= */
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const excerpt = (s, n = 40) => { const t = s.replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n) + '…' : t; };
  const hash = (s) => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; };
  const fmtDate = (ts) => new Date(ts).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' });
  const anyPanelOpen = () => $('#toc').classList.contains('open') || $('#sheet').classList.contains('open');

  // PDF 엔진은 npm 패키지(pdfjs-dist)를 jsDelivr에서 받습니다. CMap(한글 표)과 표준 글꼴이 같은 패키지에 들어 있어요.
  const PDFJS = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174';
  const CDN = {
    jszip: 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
    pdf: `${PDFJS}/build/pdf.min.js`,
    pdfWorker: `${PDFJS}/build/pdf.worker.min.js`,
    cmaps: `${PDFJS}/cmaps/`,
    fonts: `${PDFJS}/standard_fonts/`
  };
  const PALETTE = ['#8e7f6e', '#6f7f74', '#7c6f7f', '#9a8258', '#5e6b7b', '#8a6666', '#6e7a5c'];
  const THEME_COLOR = { light: '#fdfdfc', ivory: '#faf7f2', night: '#141414' };

  /* ================= 아이콘 (메뉴는 아이콘만 사용) ================= */
  const ICONS = {
    books: '<rect x="4" y="5" width="4" height="14" rx="1"/><rect x="10" y="3" width="4" height="16" rx="1"/><path d="M17 6.5l3.2-.8 2.3 12.7-3.2.8z"/>',
    back: '<path d="M15 18l-6-6 6-6"/>',
    list: '<path d="M9 6h11M9 12h11M9 18h11"/><path d="M4.5 6h.01M4.5 12h.01M4.5 18h.01"/>',
    folder: '<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H10l2 2.5h6.5A2.5 2.5 0 0 1 21 10v7.5a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z"/>',
    paste: '<rect x="6" y="4" width="12" height="17" rx="2"/><path d="M9 4V3h6v1M9 11h6M9 15h4"/>',
    bookmark: '<path d="M6.5 3.5h11v17L12 16.5l-5.5 4z"/>',
    speaker: '<path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"/>',
    stop: '<rect x="7" y="7" width="10" height="10" rx="2"/>',
    sliders: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
    moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>'
  };
  const svgIcon = (name) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
  const setIcon = (el, name) => { el.innerHTML = svgIcon(name); };
  const hydrateIcons = (root = document) => $$('[data-icon]', root).forEach((el) => setIcon(el, el.dataset.icon));

  /* ================= 설정 ================= */
  const DEFAULTS = { font: 'gothic', size: 18, ls: 0.02, theme: 'ivory', rate: 1, voice: '' };
  let S = { ...DEFAULTS };
  try { S = { ...DEFAULTS, ...JSON.parse(localStorage.getItem('seoga.settings') || '{}') }; } catch (_) { /* 손상된 값은 기본값 사용 */ }
  let dayTheme = S.theme === 'night' ? 'ivory' : S.theme;

  /* ================= 상태 ================= */
  let book = null;      // 열린 책: 메타 정보 + blocks
  let heads = [];       // 제목 블록의 인덱스 목록
  let curIdx = 0;       // 화면 상단에 있는 문단 인덱스
  let pctNow = 0;
  let ticking = false, saveT = 0, barT = 0, lastY = 0, toastT = 0;
  let shelfFilter = 'all';  // 서재 필터: all / reading / done

  /* ================= IndexedDB (서재 저장소) =================
   * meta: 목록에 쓰는 작은 정보(읽기 위치, 책갈피 등)
   * content: 본문 blocks (큰 데이터) */
  const DB = {
    _p: null,
    open() {
      return this._p ||= new Promise((resolve, reject) => {
        const req = indexedDB.open('seoga-reader', 1);
        req.onupgradeneeded = () => {
          req.result.createObjectStore('meta', { keyPath: 'id' });
          req.result.createObjectStore('content', { keyPath: 'id' });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    },
    async run(store, mode, fn) {
      const db = await this.open();
      return new Promise((resolve, reject) => {
        const t = db.transaction(store, mode);
        const q = fn(t.objectStore(store));
        t.oncomplete = () => resolve(q.result);
        t.onerror = t.onabort = () => reject(t.error || new Error('저장소 오류'));
      });
    },
    allMeta: () => DB.run('meta', 'readonly', (s) => s.getAll()),
    getMeta: (id) => DB.run('meta', 'readonly', (s) => s.get(id)),
    putMeta: (m) => DB.run('meta', 'readwrite', (s) => s.put(m)),
    getContent: (id) => DB.run('content', 'readonly', (s) => s.get(id)),
    putContent: (c) => DB.run('content', 'readwrite', (s) => s.put(c)),
    async remove(id) {
      const db = await this.open();
      return new Promise((resolve, reject) => {
        const t = db.transaction(['meta', 'content'], 'readwrite');
        t.objectStore('meta').delete(id);
        t.objectStore('content').delete(id);
        t.oncomplete = () => resolve();
        t.onerror = () => reject(t.error);
      });
    }
  };

  /* ================= 텍스트 디코딩 (utf-8 · cp949/ANSI · utf-16) ================= */
  function decodeText(buf) {
    const u8 = new Uint8Array(buf);
    if (u8[0] === 0xff && u8[1] === 0xfe) return new TextDecoder('utf-16le').decode(buf.slice(2));
    if (u8[0] === 0xfe && u8[1] === 0xff) return new TextDecoder('utf-16be').decode(buf.slice(2));
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(buf);
    } catch (_) {
      // utf-8이 아니면 한국어 Windows의 ANSI(cp949)로 간주합니다.
      return new TextDecoder('euc-kr').decode(buf);
    }
  }

  const linesToBlocks = (text) => text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((s) => s.replace(/\u3000/g, ' ').trim())
    .filter(Boolean)
    .map((x) => ({ t: 'p', x }));

  function mdToBlocks(text) {
    const out = [];
    let inCode = false;
    for (let line of text.replace(/\r\n?/g, '\n').split('\n')) {
      line = line.trim();
      if (line.startsWith('```')) { inCode = !inCode; continue; }
      if (!line) continue;
      const h = /^(#{1,6})\s+(.*)$/.exec(line);
      if (h && !inCode) { out.push({ t: 'h', x: h[2].replace(/[*_`]/g, ''), l: Math.min(h[1].length, 3) }); continue; }
      const x = line
        .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
        .replace(/\*\*|__|`/g, '')
        .replace(/^>\s?/, '')
        .replace(/^[-*+]\s+/, '• ')
        .trim();
      if (x) out.push({ t: 'p', x });
    }
    return out;
  }

  function htmlToBlocks(html) {
    const d = new DOMParser().parseFromString(html, 'text/html');
    d.querySelectorAll('script, style, nav, svg, img').forEach((n) => n.remove());
    const SEL = 'h1, h2, h3, h4, h5, h6, p, li, blockquote, pre';
    const out = [];
    d.body.querySelectorAll(SEL).forEach((el) => {
      if (el.parentElement && el.parentElement.closest(SEL)) return; // 중첩 요소 중복 방지
      const t = el.textContent.replace(/\s+/g, ' ').trim();
      if (!t) return;
      const h = /^H([1-6])$/.exec(el.tagName);
      out.push(h ? { t: 'h', x: t, l: Math.min(+h[1], 3) } : { t: 'p', x: t });
    });
    return out.length ? out : linesToBlocks(d.body.textContent || '');
  }

  async function loadZip(buf) {
    await loadScript(CDN.jszip);
    return window.JSZip.loadAsync(buf);
  }

  async function parseDocx(buf) {
    const zip = await loadZip(buf);
    const entry = zip.file('word/document.xml');
    if (!entry) throw new Error('올바른 docx 파일이 아니에요');
    const xml = new DOMParser().parseFromString(await entry.async('string'), 'application/xml');
    const blocks = [];
    for (const p of Array.from(xml.getElementsByTagName('w:p'))) {
      let text = '';
      for (const n of Array.from(p.getElementsByTagName('*'))) {
        if (n.localName === 't') text += n.textContent;
        else if (n.localName === 'tab') text += '\t';
        else if (n.localName === 'br') text += ' ';
      }
      text = text.replace(/\s+/g, ' ').trim();
      if (!text) continue;
      const st = p.getElementsByTagName('w:pStyle')[0];
      const val = st ? (st.getAttribute('w:val') || '') : '';
      const m = /heading\s*(\d)|제목\s*(\d)/i.exec(val);
      if (m) blocks.push({ t: 'h', x: text, l: Math.min(+(m[1] || m[2]), 3) });
      else if (/^(title|제목)$/i.test(val)) blocks.push({ t: 'h', x: text, l: 1 });
      else blocks.push({ t: 'p', x: text });
    }
    return { blocks };
  }

  async function parseEpub(buf) {
    const zip = await loadZip(buf);
    const container = zip.file('META-INF/container.xml');
    if (!container) throw new Error('올바른 epub 파일이 아니에요');
    const rootPath = /full-path="([^"]+)"/.exec(await container.async('string'))?.[1];
    const opfEntry = rootPath && zip.file(rootPath);
    if (!opfEntry) throw new Error('epub 구조를 읽을 수 없어요');
    const dir = rootPath.includes('/') ? rootPath.slice(0, rootPath.lastIndexOf('/') + 1) : '';
    const opf = new DOMParser().parseFromString(await opfEntry.async('string'), 'application/xml');
    const title = opf.getElementsByTagName('dc:title')[0]?.textContent?.trim();
    const manifest = {};
    Array.from(opf.getElementsByTagName('item')).forEach((it) => { manifest[it.getAttribute('id')] = it.getAttribute('href'); });
    const spine = Array.from(opf.getElementsByTagName('itemref')).map((r) => r.getAttribute('idref'));
    const blocks = [];
    for (const id of spine) {
      const href = manifest[id];
      if (!href) continue;
      const path = dir + href;
      const file = zip.file(path) || zip.file(decodeURIComponent(path));
      if (file) blocks.push(...htmlToBlocks(await file.async('string')));
    }
    return { title, blocks };
  }

  async function parsePdf(buf) {
    await loadScript(CDN.pdf);
    const lib = window.pdfjsLib;
    lib.GlobalWorkerOptions.workerSrc = await pdfWorkerUrl();
    // CMap(한글 글자 표)을 못 읽으면 한글 글자가 빈 값으로 나와서 조용히 사라집니다.
    const pdf = await lib.getDocument({
      data: new Uint8Array(buf),
      cMapUrl: CDN.cmaps,
      cMapPacked: true,
      standardFontDataUrl: CDN.fonts
    }).promise;
    const blocks = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const { items } = await page.getTextContent();
      const lines = [];
      let cur = '', y = null, end = null;
      for (const it of items) {
        if (!it.str) continue;
        const iy = Math.round(it.transform[5]);
        if (y === null || Math.abs(iy - y) > 2) {          // 높이가 바뀌면 새 줄
          if (cur.trim()) lines.push(cur.trim());
          cur = ''; y = iy; end = null;
        }
        const x = it.transform[4];
        if (end !== null && x - end > 2 && !cur.endsWith(' ')) cur += ' ';
        cur += it.str;
        end = x + (it.width || 0);
      }
      if (cur.trim()) lines.push(cur.trim());
      for (const ln of lines) {
        if (/^\d{1,4}$/.test(ln)) continue;                 // 쪽 번호만 있는 줄 제외
        const prev = blocks[blocks.length - 1];
        // 줄바꿈으로 끊긴 문장은 이어 붙입니다.
        if (prev && prev.x.length >= 30 && !/[.!?。…"”'’」』)]$/.test(prev.x) && !isHeadingLike(ln)) prev.x += ' ' + ln;
        else blocks.push({ t: 'p', x: ln });
      }
    }
    if (!blocks.length) throw new Error('글자 정보가 없는 PDF예요. 스캔본은 지원하지 않아요.');
    return { blocks };
  }

  /* ================= 목차(제목) 자동 인식 ================= */
  const KNUM = '일이삼사오육칠팔구십백천만억영〇零';
  const HEAD_RES = [
    new RegExp('^제\\s*(\\d+|[' + KNUM + ']+)\\s*(장|화|회|부|막|편|권)(?![가-힣])'),
    /^\d{1,4}\s*(장|화|회|부|막|편|권)(?![가-힣])/,
    /^장\s*\d+(?![\d가-힣])/,
    /^(Chapter|CHAPTER)\s*\d*/,
    /^(프롤로그|에필로그|서장|종장|머리말|맺음말|서문|prologue|epilogue)(?![가-힣])/i,
    /^[A-Z][A-Z0-9 .:-]{2,}$/,
    /^\d{1,3}\.\s+\S/
  ];

  function isHeadingLike(t) {
    if (!t) return false;
    if (/^#{1,6}\s/.test(t)) return true;
    if (t.length > 50 || /[.!?。…]$/.test(t)) return false;
    if (/^\d{1,3}\.\s/.test(t) && t.length > 30) return false;
    return HEAD_RES.some((r) => r.test(t));
  }

  const numOf = (t) => { const m = /\d+/.exec(t); return m ? m[0] : null; };

  // 같은 장 번호의 제목이 짧은 간격으로 두 번 나오면 뒤쪽 줄을 지워 중복을 막습니다.
  function finalize(raw) {
    const out = [];
    let last = null;
    for (const b of raw) {
      let blk = b;
      if (blk.t === 'p' && isHeadingLike(blk.x)) blk = { t: 'h', x: blk.x.replace(/^#{1,6}\s*/, ''), l: 2 };
      if (blk.t === 'h') {
        const n = numOf(blk.x);
        if (last && n && n === last.n && out.length - last.pos <= 3) continue;
        last = { pos: out.length, n };
      }
      out.push(blk);
    }
    const realCount = out.filter((b) => b.t === 'h').length;
    return realCount >= 2 ? out : synthesize(out);
  }

  // 제목이 없는 파일: 일정 분량마다 임의 목차를 만듭니다.
  function synthesize(blocks) {
    const SEG = 2800;
    const out = [];
    let acc = SEG, n = 0;
    for (const b of blocks) {
      if (b.t === 'h') { out.push(b); acc = 0; continue; }
      if (acc >= SEG) {
        n++;
        out.push({ t: 'h', x: `${n}. ${excerpt(b.x, 18)}`, l: 2, syn: true });
        acc = 0;
      }
      out.push(b);
      acc += b.x.length;
    }
    return out;
  }

  /* ================= 파일 파서 진입점 ================= */
  async function parseFile(file) {
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    const base = file.name.replace(/\.[^.]+$/, '') || '제목 없음';
    const buf = await file.arrayBuffer();
    let r;
    switch (ext) {
      case 'txt': r = { blocks: linesToBlocks(decodeText(buf)) }; break;
      case 'md':
      case 'markdown': r = { blocks: mdToBlocks(decodeText(buf)) }; break;
      case 'html':
      case 'htm': {
        const text = decodeText(buf);
        r = { title: new DOMParser().parseFromString(text, 'text/html').title, blocks: htmlToBlocks(text) };
        break;
      }
      case 'docx': r = await parseDocx(buf); break;
      case 'epub': r = await parseEpub(buf); break;
      case 'pdf': r = await parsePdf(buf); break;
      default: throw new Error('txt, docx, pdf, epub, md, html 파일만 열 수 있어요');
    }
    const blocks = finalize(r.blocks);
    if (!blocks.length) throw new Error('본문을 찾지 못했어요');
    return {
      title: (r.title || '').trim() || base,
      format: ext === 'markdown' ? 'md' : ext === 'htm' ? 'html' : ext,
      blocks
    };
  }

  /* ================= 외부 라이브러리 지연 로드 (한 번 받으면 캐시) ================= */
  const loaded = {};
  function loadScript(url) {
    if (!loaded[url]) {
      loaded[url] = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = url;
        s.crossOrigin = 'anonymous';
        s.onload = resolve;
        s.onerror = () => {
          delete loaded[url];
          reject(new Error('라이브러리를 불러오지 못했어요. 처음 한 번은 인터넷 연결이 필요해요.'));
        };
        document.head.appendChild(s);
      });
    }
    return loaded[url];
  }

  // PDF 워커를 교차 출처 주소로 직접 띄우면 실패할 수 있어서, 받은 내용을 Blob 주소로 바꿔 띄웁니다.
  let pdfWorkerBlob = null;
  async function pdfWorkerUrl() {
    if (!pdfWorkerBlob) {
      const res = await fetch(CDN.pdfWorker, { mode: 'cors' });
      if (!res.ok) throw new Error('PDF 엔진을 불러오지 못했어요. 인터넷 연결을 확인해 주세요.');
      pdfWorkerBlob = URL.createObjectURL(new Blob([await res.text()], { type: 'text/javascript' }));
    }
    return pdfWorkerBlob;
  }

  /* ================= 서재 화면 ================= */
  const COVER_TONES = [
    { bg: '#22262e', ink: '#f1eee7' },
    { bg: '#2f4b7c', ink: '#f3f1ec' },
    { bg: '#e9e5da', ink: '#2f4b7c' },
    { bg: '#4f5b52', ink: '#f1eee7' },
    { bg: '#6a5a6f', ink: '#f3f0f5' }
  ];

  // 표지: 책 id로 톤을 고르므로 같은 책은 언제나 같은 표지로 보입니다.
  function coverHTML(m, scale = 1) {
    const tone = COVER_TONES[hash(m.id) % COVER_TONES.length];
    const title = (m.title || '').trim() || '제목 없음';
    const len = Array.from(title).length;
    const base = len <= 8 ? 22 : len <= 14 ? 18 : 15;
    const pct = Math.round((m.pct || 0) * 100);
    return `<span class="cover" style="--c1:${tone.bg};--c2:${tone.ink}">
      <span class="cover-fmt">${esc(String(m.format || '').toUpperCase())}</span>
      <span class="cover-title" style="font-size:${Math.round(base * scale)}px">${esc(title)}</span>
      <span class="cover-prog"><i style="width:${pct}%"></i></span>
    </span>`;
  }

  /* ================= 서재 화면 ================= */
  async function renderShelf() {
    const shelf = $('#shelf');
    let metas = (await DB.allMeta()).sort((a, b) => (b.lastAt || 0) - (a.lastAt || 0));
    $$('#filters button').forEach((b) => b.classList.toggle('on', b.dataset.filter === shelfFilter));
    if (!metas.length) {
      shelf.innerHTML = '<div class="empty"><p class="empty-title">서재가 아직 비어 있어요</p><p>파일을 열거나 텍스트를 붙여넣으면<br>첫 책이 이곳에 놓여요.</p></div>';
      return;
    }
    const done = (m) => (m.pct || 0) >= 0.98;
    if (shelfFilter === 'reading') metas = metas.filter((m) => (m.pct || 0) > 0 && !done(m));
    if (shelfFilter === 'done') metas = metas.filter(done);
    if (!metas.length) {
      shelf.innerHTML = '<div class="empty"><p class="empty-title">이 분류에는 책이 없어요</p></div>';
      return;
    }
    shelf.innerHTML = metas.map((m) => {
      const pct = Math.round((m.pct || 0) * 100);
      const status = done(m) ? '완독' : pct ? `${pct}% 읽음` : '새 책';
      return `<article class="item" data-id="${esc(m.id)}" tabindex="0">
        ${coverHTML(m)}
        <div class="item-info">
          <h3>${esc(m.title)}</h3>
          <p>${status}</p>
        </div>
        <button class="del" data-del="${esc(m.id)}" data-icon="trash" aria-label="삭제" title="삭제"></button>
      </article>`;
    }).join('');
    hydrateIcons(shelf);
  }

  /* ================= 초기 화면 ================= */
  /* ================= 초기 화면 ================= */
  async function renderHome() {
    const metas = (await DB.allMeta()).sort((a, b) => (b.lastAt || 0) - (a.lastAt || 0));
    $('#home-count').textContent = metas.length ? `${metas.length}권` : '';
    $('#home-empty').hidden = metas.length > 0;
    const hero = $('#home-resume');
    if (!metas.length) { hero.hidden = true; return; }
    const last = metas[0];
    const pct = Math.round((last.pct || 0) * 100);
    hero.dataset.id = last.id;
    $('#resume-cover').innerHTML = coverHTML(last, 1.3);
    $('#resume-meta').textContent = pct ? `${pct}% 읽었어요` : '아직 읽지 않았어요';
    hero.hidden = false;
  }

  async function removeBook(id) {
    const m = await DB.getMeta(id);
    if (!m) return;
    if (!confirm(`「${m.title}」을(를) 서재에서 삭제할까요?\n읽은 위치와 책갈피도 함께 지워져요.`)) return;
    await DB.remove(id);
    toast('삭제했어요');
    renderShelf();
  }

  /* ================= 책 열기 · 저장 ================= */
  async function saveBookRecord(id, title, format, blocks, size = 0) {
    const old = await DB.getMeta(id);
    const meta = {
      id, title, format, size,
      addedAt: old?.addedAt || Date.now(),
      lastAt: Date.now(),
      idx: old?.idx || 0,
      pct: old?.pct || 0,
      bm: old?.bm || [],
      count: blocks.length
    };
    await DB.putContent({ id, blocks });
    await DB.putMeta(meta);
  }

  async function importFile(file) {
    busy(true, '파일을 읽는 중이에요');
    try {
      const { title, format, blocks } = await parseFile(file);
      const id = `file:${file.name}:${file.size}`;
      await saveBookRecord(id, title, format, blocks, file.size);
      await openBook(id);
    } catch (err) {
      console.error(err);
      toast(err.message || '파일을 열 수 없어요');
    } finally {
      busy(false);
    }
  }

  function openPaste() {
    $('#paste-title').value = '';
    $('#paste-text').value = '';
    $('#modal').hidden = false;
    setTimeout(() => $('#paste-text').focus(), 60);
  }

  async function savePaste() {
    const text = $('#paste-text').value;
    if (!text.trim()) { toast('붙여넣은 본문이 없어요'); return; }
    const firstLine = text.trim().split(/\r?\n/)[0];
    const title = $('#paste-title').value.trim() || excerpt(firstLine, 24);
    const blocks = finalize(linesToBlocks(text));
    const id = 'paste:' + Date.now();
    $('#modal').hidden = true;
    await saveBookRecord(id, title, 'txt', blocks, text.length);
    await openBook(id);
  }

  async function openBook(id) {
    busy(true, '책을 펼치는 중이에요');
    try {
      const [meta, content] = await Promise.all([DB.getMeta(id), DB.getContent(id)]);
      if (!meta || !content) throw new Error('책 정보를 찾을 수 없어요');
      book = { ...meta, bm: meta.bm || [], blocks: content.blocks };
      heads = [];
      book.blocks.forEach((b, i) => { if (b.t === 'h') heads.push(i); });
      renderBook();
      showView('reader');
      showBar();
      const start = Math.min(meta.idx || 0, Math.max(0, book.blocks.length - 1));
      curIdx = start;
      requestAnimationFrame(() => {
        jumpTo(start);
        lastY = window.scrollY;
        tick();
      });
      book.lastAt = Date.now();
      persist();
    } catch (err) {
      toast(err.message || '책을 열 수 없어요');
    } finally {
      busy(false);
    }
  }

  function showLibrary() {
    TTS.stop();
    if (book) { persist(); book = null; }
    showView('library');
    renderShelf();
  }

  function showView(v) {
    ['home', 'library', 'reader'].forEach((name) => $('#' + name).classList.toggle('active', name === v));
    document.body.classList.toggle('reading', v === 'reader');
    $('#prog').style.width = '0%';
    if (v !== 'reader') closePanels();
    document.title = v === 'reader' && book ? `${book.title} · 서재` : '서재';
    window.scrollTo(0, 0);
  }

  function renderBook() {
    $('#book-title').textContent = book.title;
    document.title = book.title + ' · 서재';
    const frag = document.createDocumentFragment();
    book.blocks.forEach((b) => {
      const el = document.createElement(b.t === 'h' ? 'h2' : 'p');
      el.textContent = b.x;
      if (b.t === 'h') el.className = `ch l${b.l || 2}${b.syn ? ' syn' : ''}`;
      else if (/^[“"‘'「『]/.test(b.x)) el.className = 'dlg';
      frag.appendChild(el);
    });
    $('#text').replaceChildren(frag); // 자식 요소 순서 == 블록 인덱스
  }

  /* ================= 위치 계산 · 이어 읽기 ================= */
  function visibleIndex() {
    const nodes = $('#text').children;
    let lo = 0, hi = nodes.length - 1, ans = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (nodes[mid].getBoundingClientRect().top <= 110) { ans = mid; lo = mid + 1; }
      else hi = mid - 1;
    }
    return ans;
  }

  function currentHead(i) {
    let lo = 0, hi = heads.length - 1, ans = -1;
    while (lo <= hi) {
      const m = (lo + hi) >> 1;
      if (heads[m] <= i) { ans = m; lo = m + 1; }
      else hi = m - 1;
    }
    return ans >= 0 ? book.blocks[heads[ans]].x : book.title;
  }

  function jumpTo(i, smooth = false) {
    const node = $('#text').children[i];
    if (!node) return;
    const y = node.getBoundingClientRect().top + window.scrollY - 80;
    window.scrollTo({ top: Math.max(0, y), behavior: smooth ? 'smooth' : 'auto' });
  }

  function onScroll() {
    if (!book || ticking) return;
    ticking = true;
    requestAnimationFrame(() => { ticking = false; tick(); });
  }

  function tick() {
    if (!book) return;
    const max = document.documentElement.scrollHeight - window.innerHeight;
    pctNow = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 1;
    $('#prog').style.width = (pctNow * 100).toFixed(2) + '%';
    curIdx = visibleIndex();
    $('#running').textContent = currentHead(curIdx);
    const dy = window.scrollY - lastY;
    if (Math.abs(dy) > 6) {
      if (dy > 0) hideBar();
      else if (!anyPanelOpen()) showBar();
      lastY = window.scrollY;
    }
    book.idx = curIdx;
    book.pct = pctNow;
    updateBmButton();
    clearTimeout(saveT);
    saveT = setTimeout(persist, 500);
  }

  function persist() {
    if (!book) return;
    const { blocks, ...meta } = book; // blocks는 제외하고 메타만 저장
    DB.putMeta(meta).catch(() => {});
  }

  /* ================= 책갈피 ================= */
  function toggleBookmark() {
    if (!book) return;
    const i = curIdx;
    const k = book.bm.findIndex((b) => b.i === i);
    if (k >= 0) {
      book.bm.splice(k, 1);
      toast('책갈피를 지웠어요');
    } else {
      book.bm.push({ i, x: excerpt(book.blocks[i].x, 36) });
      book.bm.sort((a, b) => a.i - b.i);
      toast('책갈피를 추가했어요');
    }
    persist();
    updateBmButton();
  }

  function removeBookmark(i) {
    if (!book) return;
    book.bm = book.bm.filter((b) => b.i !== i);
    persist();
    renderBm();
    updateBmButton();
  }

  function updateBmButton() {
    $('#btn-bm').classList.toggle('on', !!book && book.bm.some((b) => b.i === curIdx));
  }

  /* ================= 목차 · 책갈피 패널 ================= */
  function renderToc() {
    if (!book) return;
    const items = heads.map((i) => ({ i, x: book.blocks[i].x, syn: !!book.blocks[i].syn }));
    $('#toc-note').textContent = items.some((it) => it.syn)
      ? '목차가 없는 파일이라 본문을 일정 길이로 나눈 임의 목차예요.'
      : '';
    let active = -1;
    items.forEach((it, k) => { if (it.i <= curIdx) active = k; });
    $('#toc-list').innerHTML = items.length
      ? items.map((it, k) => `<button class="toc-item${k === active ? ' on' : ''}${it.syn ? ' syn' : ''}" data-i="${it.i}">${esc(it.x)}</button>`).join('')
      : '<p class="note">표시할 목차가 없어요.</p>';
    renderBm();
  }

  function renderBm() {
    if (!book) return;
    $('#bm-list').innerHTML = book.bm.length
      ? book.bm.map((b) => `<div class="bm-item"><button class="toc-item" data-i="${b.i}">${esc(b.x)}</button><button class="ico sm" data-bm-del="${b.i}" data-icon="trash" aria-label="책갈피 삭제" title="삭제"></button></div>`).join('')
      : '<p class="note">아직 책갈피가 없어요. 메뉴의 책갈피 아이콘을 눌러 추가해 보세요.</p>';
    hydrateIcons($('#bm-list'));
  }

  function showTocTab(tab) {
    $$('#toc-tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
    $('#toc-list').hidden = tab !== 'toc';
    $('#toc-note').hidden = tab !== 'toc';
    $('#bm-list').hidden = tab !== 'bm';
    if (tab === 'bm') renderBm();
  }

  function openPanel(which) {
    closePanels(true);
    if (which === 'toc') {
      renderToc();
      $('#toc').classList.add('open');
      const on = $('#toc-list .on');
      if (on) on.scrollIntoView({ block: 'center' });
    }
    if (which === 'sheet') {
      populateVoices();
      syncSettingsUI();
      $('#sheet').classList.add('open');
    }
    $('#scrim').classList.add('show');
  }

  function closePanels(keepScrim = false) {
    $('#toc').classList.remove('open');
    $('#sheet').classList.remove('open');
    if (!keepScrim) $('#scrim').classList.remove('show');
  }

  /* ================= 자동숨김 아이콘 바 ================= */
  function showBar() {
    const bar = $('#bar');
    bar.classList.remove('hidden');
    clearTimeout(barT);
    barT = setTimeout(() => { if (!anyPanelOpen()) bar.classList.add('hidden'); }, 2600);
  }
  function hideBar() {
    clearTimeout(barT);
    $('#bar').classList.add('hidden');
  }
  function toggleBar() {
    $('#bar').classList.contains('hidden') ? showBar() : hideBar();
  }

  /* ================= 설정 ================= */
  function applySettings(save = true) {
    const root = document.documentElement;
    root.style.setProperty('--fs', S.size + 'px');
    root.style.setProperty('--ls', S.ls + 'em');
    document.body.dataset.font = S.font;
    document.body.dataset.theme = S.theme;
    $('meta[name="theme-color"]').setAttribute('content', THEME_COLOR[S.theme] || THEME_COLOR.ivory);
    if (save) { try { localStorage.setItem('seoga.settings', JSON.stringify(S)); } catch (_) {} }
    syncSettingsUI();
  }

  function syncSettingsUI() {
    $$('.seg button[data-set]').forEach((b) => {
      const [k, v] = b.dataset.set.split(':');
      b.classList.toggle('on', String(S[k]) === v);
    });
    $('#s-size').value = S.size;
    $('#o-size').textContent = S.size + 'px';
    $('#s-ls').value = S.ls;
    $('#o-ls').textContent = Math.round(S.ls * 100) + '%';
    $('#s-rate').value = S.rate;
    $('#o-rate').textContent = S.rate.toFixed(1) + '배';
    $('#btn-night').classList.toggle('on', S.theme === 'night');
  }

  // 설정을 바꿔도 읽고 있던 문단이 화면에 그대로 남도록 합니다.
  function change(fn) {
    const keep = curIdx;
    fn();
    applySettings();
    if (book) requestAnimationFrame(() => jumpTo(keep));
  }

  function toggleNight() {
    change(() => {
      if (S.theme === 'night') S.theme = dayTheme;
      else { dayTheme = S.theme; S.theme = 'night'; }
    });
  }

  function populateVoices() {
    if (!('speechSynthesis' in window)) return;
    const all = speechSynthesis.getVoices();
    const ko = all.filter((v) => /^ko/i.test(v.lang));
    const list = ko.length ? ko : all;
    $('#s-voice').innerHTML = '<option value="">기기 기본 음성</option>' +
      list.map((v) => `<option value="${esc(v.voiceURI)}">${esc(v.name)} · ${esc(v.lang)}</option>`).join('');
    $('#s-voice').value = S.voice || '';
  }

  /* ================= 시스템 TTS (기기 내장 음성 · Web Speech API) ================= */
  const TTS = {
    on: false,
    i: 0,
    tok: 0,
    supported: 'speechSynthesis' in window,
    start(from) {
      if (!this.supported) { toast('이 기기에서는 음성 읽기를 쓸 수 없어요'); return; }
      this.stop();
      this.on = true;
      this.i = from;
      syncTtsButton();
      this.next();
    },
    stop() {
      this.tok++;                               // 이전 발화의 콜백을 무효화
      this.on = false;
      if (this.supported) speechSynthesis.cancel();
      $$('#text .speak').forEach((n) => n.classList.remove('speak'));
      syncTtsButton();
    },
    next() {
      if (!this.on || !book) return;
      const bl = book.blocks;
      while (this.i < bl.length && !bl[this.i].x.trim()) this.i++;
      if (this.i >= bl.length) { this.stop(); return; }
      const node = $('#text').children[this.i];
      $$('#text .speak').forEach((n) => n.classList.remove('speak'));
      node.classList.add('speak');
      keepVisible(node);
      const t = this.tok;
      const u = new SpeechSynthesisUtterance(bl[this.i].x);
      u.lang = 'ko-KR';
      u.rate = S.rate;
      const voice = S.voice && speechSynthesis.getVoices().find((v) => v.voiceURI === S.voice);
      if (voice) u.voice = voice;
      u.onend = () => { if (t === this.tok) { this.i++; this.next(); } };
      u.onerror = (e) => {
        if (t === this.tok && !/interrupted|canceled/.test(e.error)) { this.stop(); toast('음성 재생에 문제가 생겼어요'); }
      };
      speechSynthesis.speak(u);
    },
    toggle() { if (this.on) this.stop(); else this.start(curIdx); }
  };

  function syncTtsButton() {
    const b = $('#btn-tts');
    setIcon(b, TTS.on ? 'stop' : 'speaker');
    b.classList.toggle('on', TTS.on);
  }

  function keepVisible(node) {
    const r = node.getBoundingClientRect();
    if (r.top < 90 || r.bottom > window.innerHeight * 0.75) {
      window.scrollTo({ top: window.scrollY + r.top - window.innerHeight * 0.35, behavior: 'smooth' });
    }
  }

  /* ================= 메뉴 동작 ================= */
  function act(name) {
    switch (name) {
      case 'library': return showLibrary();
      case 'toc': return openPanel('toc');
      case 'open': return $('#file').click();
      case 'bm': return toggleBookmark();
      case 'tts': return TTS.toggle();
      case 'settings': return openPanel('sheet');
      case 'night': return toggleNight();
    }
  }

  function busy(on, msg = '') {
    $('#busy').hidden = !on;
    $('#busy-msg').textContent = msg;
  }

  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastT);
    toastT = setTimeout(() => t.classList.remove('show'), 2000);
  }

  /* ================= 이벤트 연결 ================= */
  function bindUI() {
    $('#btn-paste').onclick = openPaste;
    $('#btn-open-lib').onclick = () => $('#file').click();
    $('#btn-home').onclick = () => { showView('home'); renderHome(); };
    $$('#filters button').forEach((b) => { b.onclick = () => { shelfFilter = b.dataset.filter; renderShelf(); }; });
    $('#home-library').onclick = () => { showView('library'); renderShelf(); };
    $('#home-paste').onclick = openPaste;
    $('#home-open').onclick = () => $('#file').click();
    $('#home-resume').onclick = () => { const id = $('#home-resume').dataset.id; if (id) openBook(id); };

    $('#shelf').addEventListener('click', (e) => {
      const del = e.target.closest('[data-del]');
      if (del) { removeBook(del.dataset.del); return; }
      const item = e.target.closest('.item');
      if (item) openBook(item.dataset.id);
    });

    $('#file').addEventListener('change', (e) => {
      const f = e.target.files && e.target.files[0];
      e.target.value = '';
      if (f) importFile(f);
    });

    const bar = $('#bar');
    bar.addEventListener('pointerdown', () => showBar());
    bar.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (b) act(b.dataset.act);
    });

    $('#page').addEventListener('click', (e) => {
      if (e.target.closest('a, button')) return;
      if (window.getSelection && String(window.getSelection())) return; // 드래그 선택 중이면 무시
      toggleBar();
    });

    window.addEventListener('scroll', onScroll, { passive: true });
    document.addEventListener('visibilitychange', () => { if (document.hidden) persist(); });
    window.addEventListener('pagehide', persist);

    $('#scrim').onclick = () => closePanels();
    $$('[data-close]').forEach((b) => { b.onclick = () => closePanels(); });
    $$('#toc-tabs button').forEach((b) => { b.onclick = () => showTocTab(b.dataset.tab); });

    const jumpFromList = (e) => {
      const b = e.target.closest('[data-i]');
      if (!b) return;
      closePanels();
      jumpTo(+b.dataset.i, true);
    };
    $('#toc-list').addEventListener('click', jumpFromList);
    $('#bm-list').addEventListener('click', (e) => {
      const del = e.target.closest('[data-bm-del]');
      if (del) { removeBookmark(+del.dataset.bmDel); return; }
      jumpFromList(e);
    });

    $$('.seg button[data-set]').forEach((b) => {
      b.onclick = () => {
        const [k, v] = b.dataset.set.split(':');
        change(() => { S[k] = v; });
      };
    });
    $('#s-size').oninput = (e) => change(() => { S.size = +e.target.value; });
    $('#s-ls').oninput = (e) => change(() => { S.ls = +e.target.value; });
    $('#s-rate').oninput = (e) => { S.rate = +e.target.value; applySettings(); };
    $('#s-voice').onchange = (e) => { S.voice = e.target.value; applySettings(); };

    $('#paste-cancel').onclick = () => { $('#modal').hidden = true; };
    $('#paste-ok').onclick = savePaste;

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { closePanels(); $('#modal').hidden = true; }
    });
  }

  /* ================= 시작 ================= */
  function init() {
    hydrateIcons();
    bindUI();
    applySettings(false);
    syncTtsButton();
    populateVoices();
    if (TTS.supported) speechSynthesis.onvoiceschanged = populateVoices;
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js').catch((err) => console.warn('서비스 워커 등록 실패', err));
      });
    }
    showView('home');
    renderHome();
  }

  init();
})();
