// 조달청 나라장터 입찰공고정보서비스(공공데이터포털)에서 용역 공고를 키워드로 조회해
// site/data/bids.json 에 합쳐 저장한다. 의존 패키지 없음 (Node 20+).
//
//   DATA_GO_KR_KEY=<서비스키> node scripts/fetch.mjs
//
// 주의: 오퍼레이션명과 응답 필드명은 실제 키로 호출해 확인하기 전까지 미검증이다.
// 형식이 다르면 첫 응답의 필드 목록을 출력하고 실패로 끝난다.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'site', 'data', 'bids.json');
const REGION_CACHE = path.join(ROOT, 'site', 'data', 'regions.json');
const REGION_OPERATION = 'getBidPblancListInfoPrtcptPsblRgn02'; // 입찰공고 참가가능지역 조회
const BASE = 'https://apis.data.go.kr/1230000/ad/BidPublicInfoService02';
const OPERATION = 'getBidPblancListInfoServcPPSSrch02'; // 나라장터검색조건에 의한 입찰공고용역조회
const ROWS = 100;

const config = JSON.parse(await readFile(path.join(ROOT, 'config.json'), 'utf8'));
const exclude = config.excludePattern ? new RegExp(config.excludePattern, 'i') : null;
const excludeOrg = config.excludeOrgPattern ? new RegExp(config.excludeOrgPattern, 'i') : null;

// 분야와 먼 공고, 너무 큰 공고를 걸러낸다. 이미 저장된 데이터에도 똑같이 적용한다.
function wanted(row) {
  if (exclude && exclude.test(row.title)) return false;
  if (excludeOrg && excludeOrg.test(row.org || '')) return false;
  if (config.maxAmount && row.amount != null && row.amount > config.maxAmount) return false;
  return true;
}
// 재공고는 공고번호가 바뀌어 같은 사업이 두 번 보인다. 제목과 기관이 같으면 최신 것만 남긴다.
const titleKey = (row) => (row.org || '') + '|' + row.title.replace(/재공고|긴급/g, '').replace(/[^0-9A-Za-z가-힣]/g, '');

let key = process.env.DATA_GO_KR_KEY;
if (!key) console.warn('DATA_GO_KR_KEY 가 없어 수집은 건너뛰고 기존 데이터 정리만 합니다.');
// 포털은 인코딩된 키와 디코딩된 키를 둘 다 준다. 인코딩된 키면 풀어서 쓴다.
else if (/%[0-9A-Fa-f]{2}/.test(key)) key = decodeURIComponent(key);

// API 는 한국시간 yyyyMMddHHmm 을 받는다.
function kstStamp(date) {
  const d = new Date(date.getTime() + 9 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}`;
}

async function callApi(params, operation = OPERATION) {
  const qs = new URLSearchParams({ serviceKey: key, type: 'json', ...params });
  const res = await fetch(`${BASE}/${operation}?${qs}`);
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`JSON 이 아닌 응답 (HTTP ${res.status}): ${text.slice(0, 300)}`);
  }
  const header = json?.response?.header;
  if (header && header.resultCode !== '00') {
    throw new Error(`API 오류 ${header.resultCode}: ${header.resultMsg}`);
  }
  const gw = json?.OpenAPI_ServiceResponse?.cmmMsgHeader;
  if (gw) throw new Error(`API 게이트웨이 오류 ${gw.returnReasonCode}: ${gw.returnAuthMsg || gw.errMsg}`);
  const errHeader = Object.values(json || {}).find((v) => v?.header && !v.body)?.header;
  if (errHeader) throw new Error(`API 오류 ${errHeader.resultCode}: ${errHeader.resultMsg}`);
  const body = json?.response?.body;
  if (!body) throw new Error(`예상과 다른 응답 구조: ${text.slice(0, 300)}`);
  const raw = body.items;
  const items = Array.isArray(raw) ? raw : Array.isArray(raw?.item) ? raw.item : raw?.item ? [raw.item] : [];
  return { items, total: Number(body.totalCount) || 0 };
}

function normalize(it, keyword) {
  const id = it.bidNtceNo;
  const ord = it.bidNtceOrd || '000';
  const num = (v) => (v !== undefined && v !== null && v !== '' && !Number.isNaN(Number(v)) ? Number(v) : null);
  return {
    id,
    ord,
    title: (it.bidNtceNm || '').trim(),
    org: it.dminsttNm || it.ntceInsttNm || '',
    amount: num(it.presmptPrce) ?? num(it.asignBdgtAmt),
    deadline: it.bidClseDt || null,
    posted: it.bidNtceDt || null,
    method: it.cntrctCnclsMthdNm || '',
    url: `https://www.g2b.go.kr/link/PNPE027_01/single/?bidPbancNo=${id}&bidPbancOrd=${ord}`,
    keywords: [keyword],
  };
}

const end = new Date();
// API 조회기간 한도는 7일인데 꼭 7일을 채우면 "입력범위값 초과"가 나서 6일까지만 본다.
const begin = new Date(end.getTime() - Math.min(config.lookbackDays || 6, 6) * 86400 * 1000);
const range = { inqryDiv: '1', inqryBgnDt: kstStamp(begin), inqryEndDt: kstStamp(end) };
// config.industryCode 를 채우면 그 업종으로 제한된 공고만 받는다. 예: "1468" = 소프트웨어사업자(컴퓨터관련서비스사업)
if (config.industryCode) range.indstrytyCd = String(config.industryCode);

const fetched = new Map();
let checkedShape = false;
for (const keyword of key ? config.keywords : []) {
  let page = 1;
  let count = 0;
  while (true) {
    const { items, total } = await callApi({ ...range, bidNtceNm: keyword, numOfRows: String(ROWS), pageNo: String(page) });
    if (!checkedShape && items.length) {
      if (!items[0].bidNtceNo || !items[0].bidNtceNm) {
        console.error('응답 필드가 예상과 다릅니다. 실제 필드:', Object.keys(items[0]).join(', '));
        process.exit(1);
      }
      checkedShape = true;
    }
    for (const it of items) {
      const row = normalize(it, keyword);
      if (!row.id || !wanted(row)) continue;
      const prev = fetched.get(row.id);
      if (prev) {
        const kws = [...new Set([...prev.keywords, keyword])];
        fetched.set(row.id, row.ord >= prev.ord ? { ...row, keywords: kws } : { ...prev, keywords: kws });
      } else {
        fetched.set(row.id, row);
      }
      count++;
    }
    if (page * ROWS >= total || !items.length) break;
    page++;
  }
  console.log(`${keyword}: ${count}건`);
}

// 기존 데이터와 합친다. 새로 받은 것이 우선.
let existing = [];
try {
  existing = JSON.parse(await readFile(OUT, 'utf8')).items || [];
} catch {}
const merged = new Map(existing.map((x) => [x.id, x]));
for (const [id, row] of fetched) merged.set(id, { ...merged.get(id), ...row });

// 참가가능지역(지역제한)을 공고별로 조회해 붙인다. 한 번 조회한 공고는 캐시에서 읽는다.
const REGIONS = [
  ['서울', /서울/], ['부산', /부산/], ['대구', /대구/], ['인천', /인천/], ['광주', /광주/], ['대전', /대전/],
  ['울산', /울산/], ['세종', /세종/], ['경기', /경기/], ['강원', /강원/], ['충북', /충북|충청북/], ['충남', /충남|충청남/],
  ['전북', /전북|전라북/], ['전남', /전남|전라남/], ['경북', /경북|경상북/], ['경남', /경남|경상남/], ['제주', /제주/],
];
function regionsOf(apiItems) {
  const found = new Set();
  for (const it of apiItems) {
    const keys = Object.keys(it).filter((k) => /rgn/i.test(k));
    for (const k of keys.length ? keys : Object.keys(it).filter((k) => !/ntce|dt$/i.test(k))) {
      const v = String(it[k] ?? '');
      for (const [name, re] of REGIONS) if (re.test(v)) found.add(name);
    }
  }
  return [...found];
}
let regionCache = {};
try { regionCache = JSON.parse(await readFile(REGION_CACHE, 'utf8')); } catch {}
if (key) {
  let shown = false, failed = 0, asked = 0;
  for (const row of merged.values()) {
    if (!wanted(row) || regionCache[row.id]) continue;
    try {
      const { items: rg } = await callApi({ inqryDiv: '2', bidNtceNo: row.id, numOfRows: '50', pageNo: '1' }, REGION_OPERATION);
      asked++;
      if (!shown && rg.length) { console.log('지역 응답 예시:', JSON.stringify(rg[0])); shown = true; }
      regionCache[row.id] = { regions: regionsOf(rg) };
    } catch (e) {
      if (!failed++) console.warn('지역 조회 실패:', e.message);
      if (failed >= 3) { console.warn('지역 조회를 중단합니다.'); break; }
    }
  }
  console.log(`지역 조회: ${asked}건 성공, ${failed}건 실패`);
  await mkdir(path.dirname(REGION_CACHE), { recursive: true });
  await writeFile(REGION_CACHE, JSON.stringify(regionCache, null, 1) + '\n');
}
for (const row of merged.values()) if (regionCache[row.id]) row.regions = regionCache[row.id].regions;
// 지역제한이 있는데 우리 지역이 포함되지 않으면 뺀다. 제한이 없거나 조회하지 못한 공고는 남긴다.
const regionOk = (row) => !config.homeRegion || !row.regions?.length || row.regions.includes(config.homeRegion);

// 마감이 오래 지난 공고는 지운다.
const cutoff = Date.now() - (config.keepClosedDays || 14) * 86400 * 1000;
const kept = [...merged.values()].filter((x) => {
  if (!wanted(x) || !regionOk(x)) return false;
  if (!x.deadline) return true;
  const t = Date.parse(x.deadline.replace(' ', 'T') + '+09:00');
  return Number.isNaN(t) || t >= cutoff;
});
const byTitle = new Map();
for (const x of kept) {
  const k = titleKey(x);
  const prev = byTitle.get(k);
  if (!prev || (x.posted || x.id) > (prev.posted || prev.id)) byTitle.set(k, x);
}
const items = [...byTitle.values()];

await mkdir(path.dirname(OUT), { recursive: true });
// 키 없이 정리만 한 경우에는 갱신 시각과 출처를 바꾸지 않는다.
let prevMeta = {};
try { prevMeta = JSON.parse(await readFile(OUT, 'utf8')); } catch {}
const meta = key
  ? { updatedAt: new Date().toISOString(), source: '조달청 나라장터 입찰공고정보서비스' }
  : { updatedAt: prevMeta.updatedAt, source: prevMeta.source };
await writeFile(OUT, JSON.stringify({ ...meta, items }, null, 1) + '\n');
console.log(`저장: ${items.length}건 (이번에 받은 ${fetched.size}건)`);
