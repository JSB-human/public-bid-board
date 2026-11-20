// 조달청 나라장터 입찰공고정보서비스(공공데이터포털)에서 용역 공고를 키워드로 조회해
// site/data/bids.json 에 합쳐 저장한다. 의존 패키지 없음 (Node 20+).
//
//   DATA_GO_KR_KEY=<서비스키> node scripts/fetch.mjs
//
// 주의: 오퍼레이션명과 응답 필드명은 실제 키로 호출해 확인하기 전까지 미검증이다.
// 형식이 다르면 첫 응답의 필드 목록을 출력하고 실패로 끝난다.

import { writeFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { ROOT, config, API, apiKey as key, kstStamp, callApi as call, wanted, regionOk, regionsOf, normalizeNotice as normalize } from './lib.mjs';

const OUT = path.join(ROOT, 'site', 'data', 'bids.json');
const REGION_CACHE = path.join(ROOT, 'site', 'data', 'regions.json');
const REGION_OPERATION = 'getBidPblancListInfoPrtcptPsblRgn02'; // 입찰공고 참가가능지역 조회
const LICENSE_OPERATION = 'getBidPblancListInfoLicenseLimit02'; // 입찰공고 면허제한정보 조회
const OPERATION = 'getBidPblancListInfoServcPPSSrch02'; // 나라장터검색조건에 의한 입찰공고용역조회
const ROWS = 100;
const callApi = (params, operation = OPERATION) => call(API.bid, operation, params);
// 재공고는 공고번호가 바뀌어 같은 사업이 두 번 보인다. 제목과 기관이 같으면 최신 것만 남긴다.
const titleKey = (row) => (row.org || '') + '|' + row.title.replace(/재공고|긴급/g, '').replace(/[^0-9A-Za-z가-힣]/g, '');
if (!key) console.warn('DATA_GO_KR_KEY 가 없어 수집은 건너뛰고 기존 데이터 정리만 합니다.');

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
// 새 값이 비어 있으면 예전 값을 지우지 않는다.
for (const [id, row] of fetched) {
  const filled = Object.fromEntries(Object.entries(row).filter(([, v]) => v !== null && v !== ''));
  merged.set(id, { ...merged.get(id), ...filled });
}

// 참가가능지역(지역제한)을 공고별로 조회해 붙인다. 한 번 조회한 공고는 캐시에서 읽는다.
let regionCache = {};
try { regionCache = JSON.parse(await readFile(REGION_CACHE, 'utf8')); } catch {}
if (key) {
  let shown = false, shownLicense = false, failed = 0, asked = 0;
  for (const row of merged.values()) {
    const cached = regionCache[row.id];
    if (!wanted(row) || (cached && cached.licenses)) continue;
    const q = { inqryDiv: '2', bidNtceNo: row.id, bidNtceOrd: row.ord || '000', numOfRows: '50', pageNo: '1' };
    try {
      const entry = cached || {};
      if (!entry.regions) {
        const { items: rg } = await callApi(q, REGION_OPERATION);
        if (!shown && rg.length) { console.log('지역 응답 예시:', JSON.stringify(rg[0])); shown = true; }
        entry.regions = regionsOf(rg);
      }
      // 면허(업종)제한. 같은 그룹 번호끼리 묶어 둔다.
      const { items: lc } = await callApi(q, LICENSE_OPERATION);
      if (!shownLicense && lc.length) { console.log('면허 응답 예시:', JSON.stringify(lc[0])); shownLicense = true; }
      entry.licenses = lc.map((x) => ({ group: String(x.lmtGrpNo ?? ''), name: String(x.lcnsLmtNm ?? '').trim() })).filter((x) => x.name);
      regionCache[row.id] = entry;
      asked++;
    } catch (e) {
      if (!failed++) console.warn('지역 조회 실패:', e.message);
      if (failed >= 3) { console.warn('지역 조회를 중단합니다.'); break; }
    }
  }
  console.log(`지역 조회: ${asked}건 성공, ${failed}건 실패`);
  await mkdir(path.dirname(REGION_CACHE), { recursive: true });
  await writeFile(REGION_CACHE, JSON.stringify(regionCache, null, 1) + '\n');
}
for (const row of merged.values()) {
  const c = regionCache[row.id];
  if (!c) continue;
  if (c.regions) row.regions = c.regions;
  if (c.licenses) row.licenses = c.licenses;
}

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
