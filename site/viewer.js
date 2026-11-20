// 첨부파일 뷰어. 나라장터 파일을 브라우저에서 직접 받아(나라장터가 다른 사이트의 요청을 허용한다)
// PDF 는 PDF.js 로 그리고, 한글(HWP·HWPX)은 글자를 꺼내 보여 준다. ZIP 은 안의 파일 목록을 보여 준다.
import { unzip, hwpText, hwpxText, extOf } from './hwp.js';

const PDFJS = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174';
const MAX_BYTES = 40 * 1024 * 1024;

const ICON = {
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  down: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  back: '<path d="m15 18-6-6 6-6"/>',
  out: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
};
const svg = (p) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const baseName = (n) => n.split('/').pop();
const extClass = (ext) => (ext === 'pdf' ? 'pdf' : /^hwp/.test(ext) ? 'hwp' : /^xls/.test(ext) ? 'xls' : '');
function size(n) {
  if (n == null) return '';
  return n >= 1048576 ? (n / 1048576).toFixed(1) + 'MB' : Math.max(1, Math.round(n / 1024)) + 'KB';
}

let root = null, lastFocus = null, token = 0;
const stack = []; // ZIP 안으로 들어갔을 때 돌아갈 곳

function ensureRoot() {
  if (root) return root;
  root = document.createElement('div');
  root.className = 'viewer';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.innerHTML = `<div class="v-backdrop" data-close></div>
    <div class="v-sheet">
      <div class="v-head">
        <button class="v-icon v-back" hidden aria-label="뒤로">${svg(ICON.back)}</button>
        <span class="ext v-ext"></span>
        <div class="v-title"><b></b><small></small></div>
        <a class="v-dl" rel="noopener">${svg(ICON.down)}<span>내려받기</span></a>
        <button class="v-icon" data-close aria-label="닫기">${svg(ICON.close)}</button>
      </div>
      <div class="v-body" tabindex="-1"></div>
      <div class="v-page" hidden></div>
    </div>`;
  document.body.appendChild(root);
  root.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) close();
    else if (e.target.closest('.v-back')) back();
    const entry = e.target.closest('[data-entry]');
    if (entry) openEntry(Number(entry.dataset.entry));
  });
  document.addEventListener('keydown', (e) => {
    if (!root.classList.contains('show')) return;
    if (e.key === 'Escape') { stack.length ? back() : close(); }
  });
  return root;
}

function setHead(file, dl) {
  const ext = extOf(file.name);
  root.querySelector('.v-ext').className = `ext v-ext ${extClass(ext)}`;
  root.querySelector('.v-ext').textContent = (ext || 'file').toUpperCase();
  root.querySelector('.v-title b').textContent = file.name.replace(/\.[a-z0-9]+$/i, '');
  root.querySelector('.v-title small').textContent = file.sub || '';
  const a = root.querySelector('.v-dl');
  a.href = dl.href;
  if (dl.download) a.setAttribute('download', dl.download); else a.removeAttribute('download');
  root.querySelector('.v-back').hidden = !stack.length;
}

function body(html) {
  // 다른 화면으로 바뀌면 열려 있던 한글 문서 메모리를 돌려준다(그리는 중이던 쪽은 token 으로 멈춘다).
  if (!html.includes('v-pages')) freeHwp();
  const b = root.querySelector('.v-body');
  b.innerHTML = html;
  b.scrollTop = 0;
  root.querySelector('.v-page').hidden = true;
  return b;
}

function close() {
  if (!root) return;
  token++;
  stack.length = 0;
  freeHwp();
  root.classList.remove('show');
  document.documentElement.style.overflow = '';
  for (const u of objectUrls.splice(0)) URL.revokeObjectURL(u);
  lastFocus?.focus?.();
}

const objectUrls = [];
const blobUrl = (data, type) => { const u = URL.createObjectURL(new Blob([data], { type })); objectUrls.push(u); return u; };

// 진행률을 보여 주며 받기
async function download(url, my) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const total = Number(res.headers.get('content-length')) || 0;
  if (total > MAX_BYTES) throw new Error(`파일이 너무 커요(${size(total)})`);
  const reader = res.body.getReader();
  const chunks = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (my !== token) { reader.cancel(); throw new Error('cancelled'); }
    chunks.push(value);
    got += value.length;
    const p = root.querySelector('.v-progress');
    if (p) p.textContent = total ? `${Math.round((got / total) * 100)}% · ${size(got)} / ${size(total)}` : size(got);
  }
  const out = new Uint8Array(got);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

const loading = (msg) => `<div class="v-state"><div class="v-spin"></div><b>${esc(msg)}</b><span class="v-progress"></span></div>`;
const failed = (msg, href) => `<div class="v-state"><b>파일을 보여 주지 못했어요</b><span>${esc(msg)}</span>
  ${href ? `<a class="v-btn" href="${esc(href)}" rel="noopener">${svg(ICON.down)} 내려받아 열기</a>` : ''}</div>`;

export async function openViewer(file) {
  ensureRoot();
  lastFocus = document.activeElement;
  stack.length = 0;
  root.classList.add('show');
  document.documentElement.style.overflow = 'hidden';
  await show(file, { href: file.url });
  root.querySelector('.v-sheet [data-close]').focus();
}

let current = null; // 지금 보고 있는 ZIP 의 항목들

async function show(file, dl, data) {
  const my = ++token;
  setHead(file, dl);
  const ext = extOf(file.name);
  if (!['pdf', 'hwp', 'hwpx', 'zip'].includes(ext)) {
    body(failed('이 형식은 미리 볼 수 없어요. 내려받아 확인하세요.', dl.href));
    return;
  }
  body(loading('파일을 불러오는 중'));
  try {
    if (!data) data = await download(file.url, my);
    if (my !== token) return;
    if (ext === 'pdf') await showPdf(data, my);
    else if (ext === 'hwp' || ext === 'hwpx') await showHwp(data, ext, my);
    else showZip(file, data);
  } catch (e) {
    if (my !== token || e.message === 'cancelled') return;
    body(failed(e.message === 'Failed to fetch' ? '나라장터에서 파일을 받지 못했어요.' : e.message, dl.href));
  }
}

// HWPX 는 문단·표 구조가 XML 로 들어 있어, 표를 표로 그린다. (그림·글꼴 서식은 빼고)
const IMG_NOTE = /^(그림입니다\.?|원본 그림의 (이름|크기)\s*:|프로그램 이름\s*:)/;
async function hwpxHtml(buf) {
  const sections = unzip(buf)
    .filter((e) => /^Contents\/section\d+\.xml$/i.test(e.name))
    .sort((a, b) => Number(a.name.match(/\d+/)[0]) - Number(b.name.match(/\d+/)[0]));
  const kids = (el, name) => [...el.children].filter((c) => c.localName === name);
  const para = (p) => {
    let text = '';
    const blocks = [];
    for (const run of kids(p, 'run')) {
      for (const c of run.children) {
        if (c.localName === 't') {
          for (const n of c.childNodes) {
            if (n.nodeType === 3) text += n.nodeValue;
            else if (n.localName === 'tab') text += ' ';
            else if (n.localName === 'lineBreak') text += '\n';
          }
        } else if (c.localName === 'tbl') blocks.push(table(c));
      }
    }
    const t = text.trim();
    const line = t && !IMG_NOTE.test(t) ? `<p>${esc(t).replace(/\n/g, '<br>')}</p>` : '';
    return line + blocks.join('');
  };
  const cell = (tc) => {
    const span = kids(tc, 'cellSpan')[0];
    const cs = Number(span?.getAttribute('colSpan')) || 1, rs = Number(span?.getAttribute('rowSpan')) || 1;
    const inner = kids(tc, 'subList').flatMap((s) => kids(s, 'p')).map(para).join('');
    return `<td${cs > 1 ? ` colspan="${cs}"` : ''}${rs > 1 ? ` rowspan="${rs}"` : ''}>${inner}</td>`;
  };
  const table = (tbl) => `<div class="v-tbl"><table>${kids(tbl, 'tr').map((tr) => `<tr>${kids(tr, 'tc').map(cell).join('')}</tr>`).join('')}</table></div>`;
  const out = [];
  for (const e of sections) {
    const xml = new TextDecoder('utf-8').decode(await e.read());
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    if (doc.querySelector('parsererror')) throw new Error('HWPX 본문을 해석하지 못했어요');
    out.push(kids(doc.documentElement, 'p').map(para).join(''));
  }
  return out.join('');
}

function showHtml(html, why = '') {
  body(`<div class="v-note">${esc(why)} 글자와 표만 보여 드려요. 그림·서식은 내려받아 확인하세요.</div><article class="v-text v-doc">${html}</article>`);
}

function showText(text, why = '') {
  const paras = text.split('\n').map((l) => l.trim()).filter((l) => !IMG_NOTE.test(l));
  const html = [];
  let blank = 0;
  for (const l of paras) {
    if (!l) { if (++blank === 1) html.push('<div class="v-gap"></div>'); continue; }
    blank = 0;
    // 번호·기호로 시작하는 짧은 줄은 제목처럼 굵게
    const head = l.length <= 40 && /^([ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]+\.?|\d{1,2}\.|제\s*\d+\s*[장절]|[□■◆▣])\s*\S/.test(l);
    html.push(`<p class="${head ? 'h' : ''}">${esc(l)}</p>`);
  }
  body(`<div class="v-note">${esc(why)} 표·그림·서식은 내려받아 확인하세요.</div><article class="v-text">${html.join('')}</article>`);
}

function showZip(file, data) {
  renderZip({ file, entries: unzip(data) });
}

function renderZip(zip) {
  current = zip;
  const rows = current.entries.map((e, i) => {
    const ext = extOf(e.name);
    return `<button class="file" data-entry="${i}"><span class="ext ${extClass(ext)}">${esc((ext || 'file').toUpperCase())}</span>
      <span class="fname">${esc(baseName(e.name).replace(/\.[a-z0-9]+$/i, ''))}</span><span class="fsize">${size(e.size)}</span></button>`;
  }).join('');
  body(`<div class="v-note">묶음 파일 안에 ${current.entries.length}개 파일이 있어요. 누르면 열어 볼 수 있어요.</div><div class="files v-zip">${rows}</div>`);
}

async function openEntry(i) {
  const zip = current;
  const e = zip.entries[i];
  const my = ++token;
  body(loading('묶음에서 꺼내는 중'));
  const data = await e.read();
  if (my !== token) return;
  stack.push(zip);
  const ext = extOf(e.name);
  const type = ext === 'pdf' ? 'application/pdf' : 'application/octet-stream';
  await show({ name: baseName(e.name), sub: zip.file.name, url: null }, { href: blobUrl(data, type), download: baseName(e.name) }, data);
}

function back() {
  const zip = stack.pop();
  if (!zip) return;
  token++;
  setHead(zip.file, { href: zip.file.url });
  renderZip(zip);
}

// ---------- PDF ----------
let pdfjsReady = null;
function loadPdfJs() {
  if (!pdfjsReady) {
    pdfjsReady = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = `${PDFJS}/build/pdf.min.js`;
      s.onload = () => {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = `${PDFJS}/build/pdf.worker.min.js`;
        resolve(window.pdfjsLib);
      };
      s.onerror = () => { pdfjsReady = null; reject(new Error('PDF 보기 도구를 불러오지 못했어요.')); };
      document.head.appendChild(s);
    });
  }
  return pdfjsReady;
}

// 쪽마다 자리부터 잡아 두고, 화면에 들어올 때 그린다. PDF 와 한글이 같이 쓴다.
//   size(i) → { w, h } (쪽 크기, 같은 단위면 됨),  draw(i, cssWidth, dpr) → canvas
function pagedView(count, size, draw, my, note = '') {
  const b = body(`${note}<div class="v-pages"></div>`);
  const pages = b.querySelector('.v-pages');
  const counter = root.querySelector('.v-page');
  const first = size(0);
  for (let i = 0; i < count; i++) {
    const slot = document.createElement('div');
    slot.className = 'v-pg';
    slot.dataset.i = i;
    slot.style.aspectRatio = `${first.w} / ${first.h}`;
    pages.appendChild(slot);
  }
  const drawn = new Set();
  const paint = async (slot) => {
    const i = Number(slot.dataset.i);
    if (drawn.has(i) || my !== token) return;
    drawn.add(i);
    const s = size(i);
    slot.style.aspectRatio = `${s.w} / ${s.h}`;
    try {
      const canvas = await draw(i, slot.clientWidth || pages.clientWidth, Math.min(window.devicePixelRatio || 1, 2.5));
      if (my === token) slot.appendChild(canvas);
    } catch (e) {
      slot.innerHTML = `<div class="v-pgerr">${i + 1}쪽을 그리지 못했어요</div>`;
    }
  };
  const io = new IntersectionObserver((list) => {
    for (const e of list) if (e.isIntersecting) paint(e.target);
    const visible = list.filter((e) => e.isIntersecting).map((e) => Number(e.target.dataset.i));
    if (visible.length) counter.textContent = `${Math.min(...visible) + 1} / ${count}`;
  }, { root: b, rootMargin: '600px 0px' });
  const slots = pages.querySelectorAll('.v-pg');
  slots.forEach((s) => io.observe(s));
  // 화면 감지가 늦게 오더라도 첫 쪽들은 바로 그린다.
  (async () => { for (const s of [...slots].slice(0, 2)) await paint(s); })();
  counter.hidden = false;
  counter.textContent = `1 / ${count}`;
}

async function showPdf(data, my) {
  const lib = await loadPdfJs();
  const doc = await lib.getDocument({
    data,
    cMapUrl: `${PDFJS}/cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${PDFJS}/standard_fonts/`,
  }).promise;
  if (my !== token) return;
  const pagesInfo = [];
  for (let n = 1; n <= doc.numPages; n++) pagesInfo.push(null);
  const first = await doc.getPage(1);
  const v0 = first.getViewport({ scale: 1 });
  pagedView(doc.numPages, (i) => pagesInfo[i] || { w: v0.width, h: v0.height }, async (i, width, dpr) => {
    const page = i === 0 ? first : await doc.getPage(i + 1);
    const v1 = page.getViewport({ scale: 1 });
    pagesInfo[i] = { w: v1.width, h: v1.height };
    const vp = page.getViewport({ scale: (width / v1.width) * dpr });
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(vp.width);
    canvas.height = Math.floor(vp.height);
    await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
    return canvas;
  }, my);
}

// ---------- 한글 (rhwp: Rust + WebAssembly 로 만든 HWP·HWPX 렌더러, MIT) ----------
const RHWP = 'https://cdn.jsdelivr.net/npm/@rhwp/core@0.8.7';
let rhwpReady = null;
let hwpDoc = null; // 지금 열린 한글 문서. 닫을 때 WebAssembly 메모리를 돌려준다.
function loadRhwp() {
  if (!rhwpReady) {
    rhwpReady = (async () => {
      // 글자 폭은 브라우저 글꼴로 재야 줄바꿈이 맞는다(라이브러리가 요구하는 함수).
      let ctx = null, last = '';
      globalThis.measureTextWidth = (font, text) => {
        if (!ctx) ctx = document.createElement('canvas').getContext('2d');
        if (font !== last) { ctx.font = font; last = font; }
        return ctx.measureText(text).width;
      };
      const m = await import(`${RHWP}/rhwp.js`);
      await m.default({ module_or_path: `${RHWP}/rhwp_bg.wasm` });
      return m;
    })().catch((e) => { rhwpReady = null; throw e; });
  }
  return rhwpReady;
}
function freeHwp() {
  try { hwpDoc?.free(); } catch {}
  hwpDoc = null;
}

async function showHwp(data, ext, my) {
  const p = root.querySelector('.v-progress');
  if (p) p.textContent = '한글 보기 도구를 준비하는 중 (처음 한 번 약 12MB)';
  let m;
  try {
    m = await loadRhwp();
  } catch {
    return showHwpSimple(data, ext, '한글 보기 도구를 불러오지 못해 글자만 보여 드려요.');
  }
  if (my !== token) return;
  freeHwp();
  let doc;
  try {
    doc = new m.HwpDocument(data);
  } catch {
    return showHwpSimple(data, ext, '이 파일은 원본 모양으로 그리지 못해 글자만 보여 드려요.');
  }
  hwpDoc = doc;
  const sizes = [];
  const size = (i) => {
    if (!sizes[i]) { const s = JSON.parse(doc.getPageInfo(i)); sizes[i] = { w: s.width, h: s.height }; }
    return sizes[i];
  };
  pagedView(doc.pageCount(), size, async (i, width, dpr) => {
    if (my !== token || hwpDoc !== doc) throw new Error('closed');
    const canvas = document.createElement('canvas');
    doc.renderPageToCanvas(i, canvas, (width / size(i).w) * dpr);
    return canvas;
  }, my, '<div class="v-note">한글 파일을 화면용으로 다시 그린 거라 글꼴이나 줄바꿈이 원본과 조금 다를 수 있어요.</div>');
}

// 렌더러를 못 쓸 때: HWPX 는 글자와 표, HWP 는 글자만
async function showHwpSimple(data, ext, why) {
  if (ext === 'hwpx') {
    try { showHtml(await hwpxHtml(data), why); return; } catch {}
    showText(await hwpxText(data), why);
  } else showText(await hwpText(data), why);
}

window.openViewer = openViewer;
