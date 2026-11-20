// 공고 첨부파일(공고문, 제안요청서)을 내려받아 글자로 바꾸고,
// 사업 내용과 본문에만 적힌 참가 조건을 뽑아 site/data/bids.json 에 붙인다.
//
//   node scripts/docs.mjs
//
// PDF 는 poppler 의 pdftotext 로, HWPX 는 압축을 풀어 본문 XML 에서 글자를 꺼낸다.
// 옛 HWP(바이너리) 파일은 읽지 않는다. 받은 파일은 실행하지 않고 글자만 읽는다.

import { readFile, writeFile, mkdir, readdir, rm, mkdtemp } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { unzip, hwpxText, hwpText, hwpParaText } from '../site/hwp.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIDS = path.join(ROOT, 'site', 'data', 'bids.json');
const TEXT_DIR = path.join(ROOT, 'cache', 'text'); // 공고별 원문 글자. 규칙을 고치면 다시 받지 않고 이것으로 다시 뽑는다.
const MAX_BYTES = 30 * 1024 * 1024;
const TEXT_VERSION = 3; // 2: HWP 읽기 추가, 3: kordoc 으로 읽기
const config = JSON.parse(await readFile(path.join(ROOT, 'config.json'), 'utf8'));

// ---------- 파일에서 글자 꺼내기 ----------

// 한글(HWP·HWPX)과 ZIP 읽기는 뷰어와 같은 코드를 쓴다.

function pdfText(file) {
  return execFileSync('pdftotext', ['-layout', '-enc', 'UTF-8', file, '-'], { maxBuffer: 64 * 1024 * 1024 }).toString('utf8');
}

async function download(url, file) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 60000);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_BYTES) throw new Error('파일이 너무 큼');
    await writeFile(file, buf);
    return buf;
  } finally {
    clearTimeout(timer);
  }
}

const extOf = (name) => (name.match(/\.([a-z0-9]+)$/i) || [, ''])[1].toLowerCase();
const isRfp = (name) => /제안\s*요청서|과업\s*(지시|내용)서|규격서|과업지시/.test(name);
const isNotice = (name) => /공고/.test(name) && !isRfp(name);
const DOC_EXT = ['pdf', 'hwpx', 'hwp'];
const readable = (name) => [...DOC_EXT, 'zip'].includes(extOf(name));
// 같은 문서가 여러 형식으로 있으면 PDF > HWPX > HWP 순으로 고른다.
const rank = (name) => { const i = DOC_EXT.indexOf(extOf(name)); return i < 0 ? 9 : i; };
function pick(files, test) {
  const cand = files.filter((f) => test(f.name) && readable(f.name) && extOf(f.name) !== 'zip');
  return cand.sort((a, b) => rank(a.name) - rank(b.name))[0] || null;
}
// kordoc(한국 문서 파서, MIT)으로 읽어 문단·제목·표 행을 한 줄씩 만든다.
// 표 행은 칸을 빈칸으로 이어 한 줄로 만든다(번호 상자 제목 "1 | 사업일반" → "1 사업일반", 요구사항 표 → "SFR-001 이름").
// kordoc 이 실패하면 예전 방식(pdftotext, 자체 한글 읽기)으로 읽는다.
// kordoc 글에 섞인 마크다운·HTML 표시(그림, 위첨자 등)를 걷어 낸다.
const plain = (s) => String(s ?? '')
  .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
  .replace(/<br\s*\/?>/gi, '\n')
  .replace(/<[^>]+>/g, '')
  .replace(/\\([$*~_|\\])/g, '$1');

function blocksToText(blocks) {
  const out = [];
  const cellText = (c) => plain(c?.text).trim();
  for (const b of blocks || []) {
    if (b.type === 'table' && b.table) {
      const rows = b.table.cells || [];
      // 한 칸짜리 표(글상자)는 안의 문단을 그대로 줄로 낸다
      if ((b.table.cols || 0) <= 1) {
        for (const r of rows) for (const c of r) out.push(...cellText(c).split('\n'));
        continue;
      }
      // 칸의 첫 줄끼리 이어 한 줄을 만들고, 칸 안에 글머리 목록처럼 여러 줄이 있으면 그 뒤 줄들은 따로 낸다.
      for (const r of rows) {
        const heads = [], rest = [];
        for (const c of r) {
          const ls = cellText(c).split('\n').map((x) => x.trim()).filter(Boolean);
          if (!ls.length || heads[heads.length - 1] === ls[0]) continue;
          heads.push(ls[0]);
          rest.push(...ls.slice(1));
        }
        if (heads.length) out.push(heads.join(' '), ...rest);
      }
    } else if (b.text && b.type !== 'image') {
      out.push(...plain(b.text).split('\n').map((x) => x.trim()));
    }
  }
  return out.join('\n');
}

let kordocLib = null;
async function kordocText(buf) {
  kordocLib ??= await import('kordoc');
  const r = await kordocLib.parse(Buffer.from(buf), { ocr: false });
  if (!r.success) throw new Error(r.error || 'kordoc 읽기 실패');
  return blocksToText(r.blocks);
}

async function textFromBuffer(ext, buf, localPdf) {
  try {
    const t = await kordocText(buf);
    if (t.trim()) return t;
  } catch (e) {
    console.warn(`kordoc 으로 못 읽어 예전 방식 사용 (${ext}): ${e.message}`);
  }
  if (ext === 'pdf') return pdfText(localPdf);
  if (ext === 'hwpx') return hwpxText(new Uint8Array(buf));
  if (ext === 'hwp') return hwpText(new Uint8Array(buf));
  return '';
}

async function textOf(item, work) {
  const files = item.detail?.files || [];
  const zipped = files.find((f) => extOf(f.name) === 'zip' && /제안|과업|규격/.test(f.name));
  const chosen = [pick(files, isNotice), pick(files, isRfp) || zipped].filter(Boolean);
  // 공고문·제안요청서라는 이름이 없으면 읽을 수 있는 첫 파일
  if (!chosen.length) { const f = files.find((f) => readable(f.name)); if (f) chosen.push(f); }
  const parts = [];
  for (const f of chosen) {
    const local = path.join(work, `${item.id}-${parts.length}.${extOf(f.name)}`);
    const buf = await download(f.url, local);
    let name = f.name, text = '';
    if (extOf(f.name) === 'zip') {
      // 묶음 파일이면 안에서 제안요청서(없으면 첫 문서)를 꺼낸다.
      const inner = unzip(new Uint8Array(buf)).filter((e) => DOC_EXT.includes(extOf(e.name))).sort((a, b) => rank(a.name) - rank(b.name));
      const e = inner.find((e) => isRfp(e.name)) || inner[0];
      const data = e && (await e.read());
      if (!data) continue;
      name = f.name + ' › ' + e.name.split('/').pop();
      if (extOf(e.name) === 'pdf') await writeFile(local + '.pdf', data);
      text = await textFromBuffer(extOf(e.name), data, local + '.pdf');
    } else {
      text = await textFromBuffer(extOf(f.name), buf, local);
    }
    parts.push(`\n<<<${isRfp(name) || f === zipped ? 'RFP' : 'NOTICE'}:${name}>>>\n` + text);
  }
  return { text: parts.join('\n'), files: parts.map((p) => p.match(/<<<[A-Z]+:(.*)>>>/)[1]), skipped: files.filter((f) => !readable(f.name)).map((f) => f.name) };
}

// ---------- 글자에서 정보 뽑기 ----------

const clean = (s) => s.replace(/[ \t 　]+/g, ' ').replace(/ *\n */g, '\n').trim();
const isToc = (line) => /[·…‥\.]{4,}\s*\d*\s*$/.test(line) || /^\s*\d+\s*$/.test(line) || /^-\s*\d+\s*-$/.test(line.trim());

function linesOf(text) {
  return clean(text).split('\n').map((l) => l.trim()).filter((l) => l && !isToc(l));
}

// 번호나 기호로 시작하는 짧은 줄을 제목으로 본다.
const HEAD_PREFIX = /^(?:[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]+\.?|(?:I{1,3}|IV|V|VI{1,3}|IX|X)\.?(?=\s)|\d{1,2}(?:\.\d{1,2})*[.)]?|[가-하][.)]|[①-⑳]|[□■◇◆○●▶▣❍]|제\s*\d+\s*[장절조])\s*/;
function headingMatch(line, re) {
  if (line.length > 40) return false;
  const body = line.replace(HEAD_PREFIX, '').replace(/[:：]\s*$/, '').trim();
  return re.test(body) && body.length <= 22;
}

const SCOPE_RE = /^(사업|과업|용역)\s*(범위|내용|개요\s*및\s*범위)$|^주요\s*(과업|사업|용역)\s*(내용|범위)?$|^(세부\s*)?과업\s*(내용|범위|목록)$|^추진\s*내용$|^요구\s*사항\s*(목록|총괄)$/;
const BACK_RE = /^((추진|사업|용역)\s*)?(배경|목적|필요성)(\s*및\s*(배경|필요성|목적))*$/;
// 줄이 길어도 번호로 시작하고 이런 말로 시작하면 다음 절로 본다.
const NEXT_RE = /^((사업|과업|용역|서비스)\s*(개요|범위|내용|대상|현황)|주요\s*(과업|사업|용역)|추진\s*(배경|목적|방안|일정|체계|내용)|기대\s*효과|제안\s*요청|요구\s*사항|입찰|평가|공고)/;
const NOISE_RE = /^(그림입니다|원본 그림의|※)|^(사\s*업\s*명|용\s*역\s*명|사업\s*기간|용역\s*기간|과업\s*기간|사업\s*예산|소요\s*예산|용역\s*금액|사업\s*금액|용역\s*장소|사업\s*장소|계약\s*방법|구축\s*장소)\s*[:：]/;
const STOP_RE = /^(기대\s*효과|추진\s*(방안|일정|체계|목표|전략)|사업\s*추진|제안\s*요청|입찰|평가|사업\s*관리|일반\s*사항|요구\s*사항\s*(상세|세부)|과업\s*수행\s*(지침|방법)|산출물|보안|하자)/;

function section(lines, re, maxLines, maxChars) {
  // 목차를 지나 본문에 나온 제목을 쓰려고, 뒤쪽에서 내용이 붙어 있는 첫 제목을 찾는다.
  for (let i = 0; i < lines.length; i++) {
    if (!headingMatch(lines[i], re)) continue;
    const out = [];
    let chars = 0, skipping = false;
    for (let j = i + 1; j < lines.length && out.length < maxLines; j++) {
      const l = lines[j];
      const body = l.replace(HEAD_PREFIX, '').replace(/^[^\p{L}\p{N}(]+/u, '').trim();
      if (out.length && ((l.length <= 30 && (STOP_RE.test(body) || headingMatch(l, BACK_RE) || headingMatch(l, SCOPE_RE)))
        || (/^(?:[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]+\.?|(?:I{1,3}|IV|V|VI{1,3}|IX|X)\.?\s|\d{1,2}\.)\s*/.test(l) && (NEXT_RE.test(body) || STOP_RE.test(body))))) break;
      if (/^<<</.test(l)) break;
      // 사업명·기간·예산 같은 개요 줄과 ※ 주석은 빼고, 그 줄이 이어진 다음 줄들도 글머리표가 나올 때까지 뺀다.
      if (NOISE_RE.test(body) || /^\s*※/.test(l)) { skipping = true; continue; }
      const bullet = /^([-‐–·•‧❍○●◦〇ㅇ□■▶‣*]|[가-하]\.|\d{1,2}[.)]|[①-⑳]|[-])/.test(l);
      if (skipping && !bullet) continue;
      skipping = false;
      if (l.length < 2 || /^[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩIVX\d.\s-]+$/.test(l)) continue;
      out.push(l);
      chars += l.length;
      if (chars > maxChars) break;
    }
    if (out.join('').length >= 20) return out;
  }
  return [];
}

const REGIONS = [
  ['서울', /서울/], ['부산', /부산/], ['대구', /대구/], ['인천', /인천/], ['광주', /광주/], ['대전', /대전/],
  ['울산', /울산/], ['세종', /세종/], ['경기', /경기/], ['강원', /강원/], ['충북', /충청북|충북/], ['충남', /충청남|충남/],
  ['전북', /전라북|전북/], ['전남', /전라남|전남/], ['경북', /경상북|경북/], ['경남', /경상남|경남/], ['제주', /제주/],
];
const REGION_WORD = '(서울특별시|서울시|부산광역시|대구광역시|인천광역시|광주광역시|대전광역시|울산광역시|세종특별자치시|경기도|강원특별자치도|강원도|충청북도|충청남도|전북특별자치도|전라북도|전라남도|경상북도|경상남도|제주특별자치도|전남광주통합특별시|[가-힣]{1,4}(?:시|군|구))';

function regionsIn(s) {
  return REGIONS.filter(([, re]) => re.test(s)).map(([n]) => n);
}

// 자주 나오는 직접생산확인 품목. 번호가 맞으면 이 이름을 쓴다.
const PRODUCTS = {
  '8111159901': '정보시스템개발서비스', '8111189901': '정보시스템유지관리서비스', '8111200202': '빅데이터분석서비스',
  '8115169901': '공간정보DB구축서비스', '8111229901': '소프트웨어유지및지원서비스', '8111159801': '패키지소프트웨어개발및도입서비스',
  '8111219901': '인터넷지원개발서비스',
};

function conditions(text) {
  const flat = clean(text).replace(/\n/g, ' ');
  const found = { regionReq: [], regionEvidence: '', regionDuty: false, direct: [], period: '' };

  // 본문에 적힌 소재지 제한: "본점 소재지가 경기도인 업체", "주된 영업소 소재지가 ○○도 내", "○○도 소재 업체"
  const pats = [
    new RegExp(`(?:본점|주된\\s*영업소|영업소|사업장)\\s*(?:의\\s*)?소재지\\s*[가이]?\\s*${REGION_WORD}[^.。]{0,25}?(?:인|에\\s*있는|내|관내)\\s*(?:업체|자|사업자)`, 'g'),
    new RegExp(`${REGION_WORD}\\s*(?:내|관내)?\\s*(?:에\\s*)?(?:본점|주된\\s*영업소)[^.。]{0,15}?(?:두고|둔|소재한|있는)\\s*(?:업체|자)`, 'g'),
    new RegExp(`${REGION_WORD}\\s*(?:관내|내)\\s*(?:소재\\s*)?업체`, 'g'),
    // "본점소재지(개인사업자인 경우에는 …)가 경기도인 업체" 처럼 괄호 설명이 끼는 경우
    new RegExp(`(?:본점|주된\\s*영업소|영업소)\\s*소재지[^.。]{0,160}?\\)\\s*[가이]\\s*${REGION_WORD}\\s*(?:인|내|에\\s*있는)\\s*(?:업체|자)`, 'g'),
  ];
  for (const re of pats) {
    for (const m of flat.matchAll(re)) {
      const near = flat.slice(Math.max(0, m.index - 40), m.index + m[0].length + 10);
      if (/공동수급|구성원|분담|지분/.test(near)) continue; // 지역의무 공동도급은 따로 본다
      const rg = regionsIn(m[1]);
      const name = rg.length ? rg : [m[1]];
      for (const r of name) if (!found.regionReq.includes(r)) found.regionReq.push(r);
      if (!found.regionEvidence) found.regionEvidence = m[0].slice(0, 120);
    }
  }
  if (/지역\s*의무\s*공동\s*도급|공동수급체\s*구성원\s*중[^.。]{0,40}지역\s*업체/.test(flat)) found.regionDuty = true;

  // 직접생산확인 품목: "○○서비스 … 8111159901" 같은 이름과 10자리 번호
  for (const m of flat.matchAll(/([가-힣A-Za-z ]{2,24}?서비스)\s*[,(（:：\[\]【】\-–]*\s*(?:세부\s*품명\s*번호|물품\s*분류\s*번호|세부품명|번호)?\s*[:：]?\s*(81\d{8})/g)) {
    const name = PRODUCTS[m[2]] || m[1].replace(/\s+/g, '').replace(/^.*(?:품명|및|또는|,)/, '');
    if (!found.direct.some((d) => d.code === m[2])) found.direct.push({ name, code: m[2] });
  }
  if (!found.direct.length && /직접\s*생산\s*확인/.test(flat)) found.direct.push({ name: '직접생산확인 필요(품목은 원문 확인)', code: '' });

  const p = flat.match(/(?:용역|사업|과업|계약)\s*기간\s*[:：]\s*([^:：]{4,60}?)(?=\s+(?:[가-하]\s*[.)]\s*[가-힣]|\d{1,2}\s*[.)]\s*[가-힣]|\(|※|용역|사업|과업|기초|추정|배정|계약|입찰)|\s*$)/);
  // 날짜 범위로 적혀 있으면 그 모양 그대로 끝까지 가져온다.
  const D = '\\d{4}\\s*[.년]\\s*\\d{1,2}\\s*[.월]\\s*(?:\\d{1,2}\\s*[.일]?)?';
  const range = flat.match(new RegExp(`(?:용역|사업|과업|계약)\\s*기간\\s*[:：]\\s*((?:${D}|계약\\s*(?:체결)?일|착수일)\\s*(?:부터|로부터)?\\s*[~∼～-]\\s*(?:${D}|\\d{1,2}\\s*[.월]\\s*(?:\\d{1,2}\\s*[.일]?)?)(?:\\s*\\([^)]{0,24}\\))?)`));
  if (range) found.period = range[1].replace(/\s+/g, ' ').trim();
  else if (p) found.period = p[1].replace(/\s+/g, ' ').replace(/[\s❍○●□■ㅇ〇\-–]+$/, '').trim();
  return found;
}

// 요구사항 번호(SFR-001 등) 표로 된 범위는 이름만 모은다.
function requirementList(lines) {
  const ID = /\b[A-Z]{2,4}-\d{3}\b/;
  if (lines.filter((l) => ID.test(l)).length < 3) return lines;
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/\b[A-Z]{2,4}-\d{3}\b\s*(.*)$/);
    if (!m) continue;
    let name = m[1].replace(/\s*\b[A-Z]{2,4}-\d{3}\b.*$/, '').replace(/\s+\d+$/, '').trim();
    if (!name && lines[i + 1] && !ID.test(lines[i + 1])) name = lines[i + 1];
    name = name.replace(/^(기능|성능|인터페이스|데이터|테스트|보안|품질|제약|유지관리\s*수행|프로젝트\s*(관리|지원))\s*요구\s*사항\s*\d*\s*/, '').trim();
    if (name && !out.includes(name)) out.push(name);
  }
  return out.length ? out : lines;
}

// 글머리표 없이 시작하는 줄은 앞줄이 줄바꿈된 것으로 보고 붙인다.
const BULLET = /^([-‐–·•‧❍○●◦〇ㅇ□■▶‣*※]|[가-하][.)]|\d{1,2}(?:\.\d{1,2})*[.)]|[①-⑳]|[-])/;
function mergeContinuations(lines) {
  const out = [];
  for (const l of lines) {
    if (out.length && !BULLET.test(l)) out[out.length - 1] += ' ' + l;
    else out.push(l);
  }
  return out;
}

function parse(text) {
  const rfpPart = text.split(/<<<RFP:/)[1];
  const scopeSource = linesOf(rfpPart ? rfpPart : text);
  const allLines = linesOf(text);
  let scope = section(scopeSource, SCOPE_RE, 40, 1200);
  if (!scope.length) scope = section(allLines, SCOPE_RE, 40, 1200);
  const req = requirementList(scope);
  scope = (req !== scope ? req : mergeContinuations(scope)).slice(0, 14);
  let background = section(scopeSource, BACK_RE, 4, 320);
  if (!background.length) background = section(allLines, BACK_RE, 4, 320);
  // 공고문에만 있는 "용역내용 : …" 한 줄
  if (!scope.length) {
    const m = clean(text).replace(/\n/g, ' ').match(/(?:용역|과업|사업)\s*(?:내용|개요)\s*[:：]\s*([^:：]{6,200}?)(?=\s+(?:[다라마바사아]\s*[.)]|※|기초|추정|배정|용역기간|사업기간|$))/);
    if (m && !/제안\s*요청서\s*(참조|참고)|과업\s*지시서\s*(참조|참고)/.test(m[1])) scope = [m[1].trim()];
  }
  return { scope, background, ...conditions(text) };
}

export { parse, conditions, hwpxText, hwpText, hwpParaText, blocksToText };

// ---------- 실행 ----------
// 다른 스크립트(시험 등)에서 불러올 때는 실행하지 않는다.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();

async function main() {

const data = JSON.parse(await readFile(BIDS, 'utf8'));
await mkdir(TEXT_DIR, { recursive: true });
const work = await mkdtemp(path.join(tmpdir(), 'bid-docs-'));
let downloaded = 0, failed = 0;

for (const item of data.items) {
  const textFile = path.join(TEXT_DIR, item.id + '.txt');
  let raw = null;
  try {
    raw = JSON.parse(await readFile(textFile, 'utf8'));
  } catch {}
  // 읽을 수 있는 형식이 늘어나면(버전이 오르면) 예전에 받아 둔 공고도 다시 읽는다.
  if (raw && (raw.v || 1) < TEXT_VERSION) raw = null;
  if (!raw && item.detail?.files?.length) {
    try {
      raw = { v: TEXT_VERSION, ...(await textOf(item, work)) };
      await writeFile(textFile, JSON.stringify(raw));
      downloaded++;
    } catch (e) {
      failed++;
      console.warn(`첨부 읽기 실패 ${item.id}: ${e.message}`);
      continue;
    }
  }
  if (!raw) continue;
  const doc = raw.text.trim() ? parse(raw.text) : { scope: [], background: [], regionReq: [], direct: [], period: '' };
  doc.files = raw.files;
  doc.skipped = raw.skipped;
  item.doc = doc;
}
await rm(work, { recursive: true, force: true });

// 본문에 다른 지역 소재 조건이 적힌 공고는 뺀다.
const home = config.homeRegion;
const removed = [];
data.items = data.items.filter((x) => {
  const req = x.doc?.regionReq || [];
  if (home && req.length && !req.includes(home)) { removed.push(`${x.title} (${req.join('·')})`); return false; }
  return true;
});

// 목록에서 사라진 공고의 원문 글자는 지운다.
const keep = new Set(data.items.map((x) => x.id + '.txt'));
for (const f of await readdir(TEXT_DIR)) if (!keep.has(f)) await rm(path.join(TEXT_DIR, f), { force: true });

await writeFile(BIDS, JSON.stringify(data, null, 1) + '\n');
const withScope = data.items.filter((x) => x.doc?.scope?.length).length;
console.log(`첨부 새로 읽음 ${downloaded}건, 실패 ${failed}건, 사업 내용 추출 ${withScope}/${data.items.length}건`);
if (removed.length) console.log('본문 지역 조건으로 제외:\n  ' + removed.join('\n  '));
}
