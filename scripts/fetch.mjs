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
const BASE = 'https://apis.data.go.kr/1230000/ad/BidPublicInfoService02';
const OPERATION = 'getBidPblancListInfoServcPPSSrch02'; // 나라장터검색조건에 의한 입찰공고용역조회
const ROWS = 100;

const config = JSON.parse(await readFile(path.join(ROOT, 'config.json'), 'utf8'));
const exclude = config.excludePattern ? new RegExp(config.excludePattern, 'i') : null;

let key = process.env.DATA_GO_KR_KEY;
if (!key) {
  console.warn('DATA_GO_KR_KEY 가 없어 수집을 건너뜁니다. 기존 데이터를 그대로 둡니다.');
  process.exit(0);
}
// 포털은 인코딩된 키와 디코딩된 키를 둘 다 준다. 인코딩된 키면 풀어서 쓴다.
if (/%[0-9A-Fa-f]{2}/.test(key)) key = decodeURIComponent(key);

// API 는 한국시간 yyyyMMddHHmm 을 받는다.
function kstStamp(date) {
  const d = new Date(date.getTime() + 9 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}`;
}

async function callApi(params) {
  const qs = new URLSearchParams({ serviceKey: key, type: 'json', ...params });
  const res = await fetch(`${BASE}/${OPERATION}?${qs}`);
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
const begin = new Date(end.getTime() - Math.min(config.lookbackDays || 7, 7) * 86400 * 1000); // API 조회기간 한도 7일
const range = { inqryDiv: '1', inqryBgnDt: kstStamp(begin), inqryEndDt: kstStamp(end) };
// config.industryCode 를 채우면 그 업종으로 제한된 공고만 받는다. 예: "1468" = 소프트웨어사업자(컴퓨터관련서비스사업)
if (config.industryCode) range.indstrytyCd = String(config.industryCode);

const fetched = new Map();
let checkedShape = false;
for (const keyword of config.keywords) {
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
      if (!row.id || (exclude && exclude.test(row.title))) continue;
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

// 마감이 오래 지난 공고는 지운다.
const cutoff = Date.now() - (config.keepClosedDays || 14) * 86400 * 1000;
const items = [...merged.values()].filter((x) => {
  if (!x.deadline) return true;
  const t = Date.parse(x.deadline.replace(' ', 'T') + '+09:00');
  return Number.isNaN(t) || t >= cutoff;
});

await mkdir(path.dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify({ updatedAt: new Date().toISOString(), source: '조달청 나라장터 입찰공고정보서비스', items }, null, 1) + '\n');
console.log(`저장: ${items.length}건 (이번에 받은 ${fetched.size}건)`);
