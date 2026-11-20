// 한글(HWP 5.x, HWPX)과 ZIP 에서 글자를 꺼내는 코드.
// 브라우저(뷰어)와 Node(수집 배치)가 같이 쓴다. 외부 라이브러리 없이 표준 API 만 쓴다.

const td = (enc) => new TextDecoder(enc);
const u16 = (b, o) => b[o] | (b[o + 1] << 8);
const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
const i32 = (b, o) => b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24);

function concat(parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

// raw deflate 풀기. 끝에 군더더기가 붙은 스트림도 있어, 오류가 나도 그때까지 풀린 내용은 쓴다.
export async function inflateRaw(data) {
  const reader = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
  const chunks = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
  } catch (e) {
    if (!chunks.length) throw e;
  }
  return concat(chunks);
}

// ---------- ZIP (HWPX 도 ZIP 이다) ----------
export function unzip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66000); i--) {
    if (u32(buf, i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('ZIP 형식이 아님');
  const count = u16(buf, eocd + 10);
  let p = u32(buf, eocd + 16);
  const out = [];
  for (let n = 0; n < count; n++) {
    if (u32(buf, p) !== 0x02014b50) break;
    const flags = u16(buf, p + 8), method = u16(buf, p + 10), csize = u32(buf, p + 20);
    const nameLen = u16(buf, p + 28), extraLen = u16(buf, p + 30), commentLen = u16(buf, p + 32);
    const local = u32(buf, p + 42);
    const rawName = buf.subarray(p + 46, p + 46 + nameLen);
    // 한국어 윈도우에서 만든 ZIP 은 파일 이름이 CP949 인 경우가 많다.
    const name = flags & 0x800 ? td('utf-8').decode(rawName) : td('euc-kr').decode(rawName);
    out.push({
      name,
      size: u32(buf, p + 24),
      async read() {
        const start = local + 30 + u16(buf, local + 26) + u16(buf, local + 28);
        const data = buf.subarray(start, start + csize);
        if (method === 0) return data;
        if (method === 8) return inflateRaw(data);
        throw new Error('지원하지 않는 압축 방식');
      },
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out.filter((e) => !e.name.endsWith('/'));
}

// ---------- HWPX ----------
function unescapeXml(s) {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

export async function hwpxText(buf) {
  const sections = unzip(buf)
    .filter((e) => /^Contents\/section\d+\.xml$/i.test(e.name))
    .sort((a, b) => Number(a.name.match(/\d+/)[0]) - Number(b.name.match(/\d+/)[0]));
  const parts = [];
  for (const e of sections) {
    const xml = td('utf-8').decode(await e.read());
    parts.push(xml
      .replace(/<hp:tab[^>]*\/>/g, ' ')
      .replace(/<\/hp:p>/g, '\n')
      .replace(/<hp:t(?:\s[^>]*)?>([\s\S]*?)<\/hp:t>/g, (_, t) => '\u0001' + t + '\u0002')
      .replace(/<[^>]+>/g, '')
      .replace(/[^\u0001\u0002\n]*?\u0001([\s\S]*?)\u0002/g, '$1')
      .replace(/\u0001|\u0002/g, ''));
  }
  return unescapeXml(parts.join('\n'));
}

// ---------- HWP 5.x ----------
// MS 복합문서(CFB) 안에 BodyText/Section0, Section1 … 스트림이 있고,
// 각 스트림은 (대개 압축된) 레코드 묶음이다. 문단 글자는 HWPTAG_PARA_TEXT(67) 레코드에 UTF-16 으로 들어 있다.
function cfbStreams(buf) {
  if (u32(buf, 0) !== 0xe011cfd0 || u32(buf, 4) !== 0xe11ab1a1) throw new Error('HWP(복합문서) 형식이 아님');
  const secSize = 1 << u16(buf, 30);
  const miniSize = 1 << u16(buf, 32);
  const dirStart = i32(buf, 48);
  const miniCutoff = u32(buf, 56);
  const miniFatStart = i32(buf, 60);
  let difatNext = i32(buf, 68);
  const sec = (n) => buf.subarray(512 + n * secSize, 512 + (n + 1) * secSize);
  const fatSectors = [];
  for (let i = 0; i < 109; i++) { const s = i32(buf, 76 + i * 4); if (s >= 0) fatSectors.push(s); }
  for (let guard = 0; difatNext >= 0 && guard < 10000; guard++) {
    const d = sec(difatNext);
    for (let i = 0; i < secSize / 4 - 1; i++) { const s = i32(d, i * 4); if (s >= 0) fatSectors.push(s); }
    difatNext = i32(d, secSize - 4);
  }
  const fat = [];
  for (const s of fatSectors) { const d = sec(s); for (let i = 0; i < secSize / 4; i++) fat.push(i32(d, i * 4)); }
  const chain = (start, table) => { const out = []; for (let s = start, g = 0; s >= 0 && g < 1e6; s = table[s], g++) out.push(s); return out; };
  const readChain = (start) => concat(chain(start, fat).map(sec));

  const dir = readChain(dirStart);
  const entries = [];
  for (let off = 0; off + 128 <= dir.length; off += 128) {
    const nameLen = u16(dir, off + 64);
    entries.push({
      name: td('utf-16le').decode(dir.subarray(off, off + Math.max(0, nameLen - 2))),
      type: dir[off + 66],
      left: i32(dir, off + 68), right: i32(dir, off + 72), child: i32(dir, off + 76),
      start: i32(dir, off + 116), size: u32(dir, off + 120),
    });
  }
  const root = entries[0];
  const miniStream = root && root.start >= 0 ? readChain(root.start) : new Uint8Array(0);
  const miniFat = [];
  if (miniFatStart >= 0) { const d = readChain(miniFatStart); for (let i = 0; i + 4 <= d.length; i += 4) miniFat.push(i32(d, i)); }
  const readEntry = (e) => e.size < miniCutoff
    ? concat(chain(e.start, miniFat).map((s) => miniStream.subarray(s * miniSize, (s + 1) * miniSize))).subarray(0, e.size)
    : readChain(e.start).subarray(0, e.size);
  // 디렉터리 트리를 따라 "저장소/스트림" 경로를 만든다.
  const out = new Map();
  const walk = (id, prefix, seen) => {
    if (id < 0 || id >= entries.length || seen.has(id)) return;
    seen.add(id);
    const e = entries[id];
    walk(e.left, prefix, seen);
    walk(e.right, prefix, seen);
    const p = prefix + e.name;
    if (e.type === 2) out.set(p, () => readEntry(e));
    else if (e.type === 1) walk(e.child, p + '/', seen);
  };
  if (root) walk(root.child, '', new Set());
  return out;
}

// 문단 글자 레코드 하나를 글자로 바꾼다. 제어문자 중 일부는 8글자(16바이트) 자리를 차지한다.
const WIDE_CTRL = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23]);
export function hwpParaText(data) {
  let s = '';
  for (let i = 0; i + 1 < data.length; ) {
    const c = u16(data, i);
    if (c < 32) {
      if (c === 9) s += ' ';
      else if (c === 10 || c === 13) s += '\n';
      i += WIDE_CTRL.has(c) ? 16 : 2;
    } else {
      s += String.fromCharCode(c);
      i += 2;
    }
  }
  return s;
}

export async function hwpText(buf) {
  const streams = cfbStreams(buf);
  const header = streams.get('FileHeader')?.();
  if (!header) throw new Error('HWP 헤더 없음');
  const props = u32(header, 36);
  if (props & 2) throw new Error('암호가 걸린 HWP');
  if (props & 4) throw new Error('배포용 HWP(본문 암호화)');
  const compressed = (props & 1) === 1;
  const sections = [...streams.keys()]
    .filter((k) => /^BodyText\/Section\d+$/.test(k))
    .sort((a, b) => Number(a.match(/\d+$/)[0]) - Number(b.match(/\d+$/)[0]));
  const paras = [];
  for (const k of sections) {
    let data = streams.get(k)();
    if (compressed) data = await inflateRaw(data);
    for (let off = 0; off + 4 <= data.length; ) {
      const h = u32(data, off);
      const tag = h & 0x3ff;
      let size = h >>> 20;
      off += 4;
      if (size === 0xfff) { size = u32(data, off); off += 4; }
      if (tag === 67) paras.push(hwpParaText(data.subarray(off, off + size)).replace(/\n+$/, ''));
      off += size;
    }
  }
  return paras.join('\n');
}

export const extOf = (name) => ((name || '').match(/\.([a-z0-9]+)$/i) || [, ''])[1].toLowerCase();
