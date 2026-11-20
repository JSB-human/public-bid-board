// 수집 스크립트들이 같이 쓰는 설정·API 호출·거르기 규칙.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const config = JSON.parse(await readFile(path.join(ROOT, 'config.json'), 'utf8'));

export const API = {
  bid: 'https://apis.data.go.kr/1230000/ad/BidPublicInfoService02', // 입찰공고
  scsbid: 'https://apis.data.go.kr/1230000/as/ScsbidInfoService', // 낙찰·개찰
  cntrct: 'https://apis.data.go.kr/1230000/ao/CntrctInfoService', // 계약
  usr: 'https://apis.data.go.kr/1230000/ao/UsrInfoService02', // 조달업체 정보
  nps: 'https://apis.data.go.kr/B552015/NpsBplcInfoInqireServiceV2', // 국민연금 가입 사업장
};

// 포털은 인코딩된 키와 디코딩된 키를 둘 다 준다. 인코딩된 키면 풀어서 쓴다.
let key = process.env.DATA_GO_KR_KEY || '';
if (/%[0-9A-Fa-f]{2}/.test(key)) key = decodeURIComponent(key);
export const apiKey = key;

// API 는 한국시간 yyyyMMddHHmm 을 받는다.
export function kstStamp(date) {
  const d = new Date(date.getTime() + 9 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}`;
}
export const parseKst = (s) => {
  if (!s) return null;
  const t = Date.parse(String(s).trim().replace(' ', 'T') + (String(s).length <= 10 ? 'T00:00:00+09:00' : '+09:00'));
  return Number.isNaN(t) ? null : t;
};
export const num = (v) => (v !== undefined && v !== null && v !== '' && !Number.isNaN(Number(v)) ? Number(v) : null);

export const stats = { calls: 0 };

// 공공데이터포털은 가끔 "어플리케이션 에러"를 내므로 몇 번 다시 시도한다. 입력값 오류는 재시도하지 않는다.
export async function callApi(base, operation, params) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await callApiOnce(base, operation, params);
    } catch (e) {
      if (attempt >= 4 || /API 오류 (06|07|08)|등록되지 않은/.test(e.message)) throw e;
      await new Promise((r) => setTimeout(r, attempt * 3000));
    }
  }
}

async function callApiOnce(base, operation, params) {
  stats.calls++;
  const fmt = base === API.nps ? { dataType: 'json' } : { type: 'json' };
  const qs = new URLSearchParams({ serviceKey: key, ...fmt, ...params });
  const res = await fetch(`${base}/${operation}?${qs}`);
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`JSON 이 아닌 응답 (HTTP ${res.status}): ${text.slice(0, 300)}`);
  }
  const header = json?.response?.header;
  if (header && !['00', '0'].includes(String(header.resultCode))) {
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

// ---------- 거르기 규칙 (진행 중 공고와 마감 공고가 같이 쓴다) ----------
const exclude = config.excludePattern ? new RegExp(config.excludePattern, 'i') : null;
const excludeOrg = config.excludeOrgPattern ? new RegExp(config.excludeOrgPattern, 'i') : null;

// 분야와 먼 공고, 너무 큰 공고를 걸러낸다.
export function wanted(row) {
  if (exclude && exclude.test(row.title || '')) return false;
  if (excludeOrg && excludeOrg.test(row.org || '')) return false;
  if (config.maxAmount && row.amount != null && row.amount > config.maxAmount) return false;
  return true;
}
// 지역제한이 있는데 우리 지역이 포함되지 않으면 뺀다. 제한이 없거나 조회하지 못한 공고는 남긴다.
export const regionOk = (row) => !config.homeRegion || !row.regions?.length || row.regions.includes(config.homeRegion);

const REGIONS = [
  ['서울', /서울/], ['부산', /부산/], ['대구', /대구/], ['인천', /인천/], ['광주', /광주/], ['대전', /대전/],
  ['울산', /울산/], ['세종', /세종/], ['경기', /경기/], ['강원', /강원/], ['충북', /충북|충청북/], ['충남', /충남|충청남/],
  ['전북', /전북|전라북/], ['전남', /전남|전라남/], ['경북', /경북|경상북/], ['경남', /경남|경상남/], ['제주', /제주/],
];
export function regionsOf(apiItems) {
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

// 입찰공고 API 한 줄을 사이트에서 쓰는 모양으로 바꾼다.
export function normalizeNotice(it, keyword) {
  const id = it.bidNtceNo;
  const ord = it.bidNtceOrd || '000';
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
    keywords: keyword ? [keyword] : [],
    detail: {
      category: [it.pubPrcrmntMidClsfcNm, it.pubPrcrmntClsfcNm].filter(Boolean),
      kind: it.ntceKindNm || '',
      reNotice: it.reNtceYn === 'Y',
      noticeOrg: it.ntceInsttNm || '',
      award: it.sucsfbidMthdNm || '',
      bidMethod: it.bidMethdNm || '',
      joint: it.cmmnSpldmdMethdNm || '',
      techRate: num(it.techAbltEvlRt),
      priceRate: num(it.bidPrceEvlRt),
      budget: num(it.asignBdgtAmt),
      regDeadline: it.bidQlfctRgstDt || null,
      bidBegin: it.bidBeginDt || null,
      opening: it.opengDt || null,
      refNo: it.refNo || '',
      files: Array.from({ length: 10 }, (_, i) => ({ name: it[`ntceSpecFileNm${i + 1}`], url: it[`ntceSpecDocUrl${i + 1}`] })).filter((f) => f.name && f.url),
    },
  };
}

// 회사 이름 비교용: 법인 표기와 띄어쓰기를 뺀다.
export const corpKey = (name) => String(name || '').replace(/주식회사|\(주\)|㈜|\(유\)|유한회사|\(사\)|사단법인|재단법인|\(재\)|\s|[.,·]/g, '').toLowerCase();
