// 낙찰·개찰·계약 API 가 이 키로 열리는지, 응답이 어떤 모양인지 확인하는 일회용 시험.
//   DATA_GO_KR_KEY=… node scripts/probe.mjs
let key = process.env.DATA_GO_KR_KEY;
if (/%[0-9A-Fa-f]{2}/.test(key)) key = decodeURIComponent(key);
const kst = (d) => { const x = new Date(d.getTime() + 9 * 3600e3); const p = (n) => String(n).padStart(2, '0'); return `${x.getUTCFullYear()}${p(x.getUTCMonth() + 1)}${p(x.getUTCDate())}${p(x.getUTCHours())}${p(x.getUTCMinutes())}`; };
const end = new Date(), begin = new Date(end.getTime() - 6 * 86400e3);

async function call(base, op, params) {
  const qs = new URLSearchParams({ serviceKey: key, type: 'json', pageNo: '1', numOfRows: '20', ...params });
  const res = await fetch(`https://apis.data.go.kr/1230000/${base}/${op}?${qs}`);
  const text = await res.text();
  try {
    const j = JSON.parse(text);
    const body = j?.response?.body;
    const raw = body?.items;
    const items = Array.isArray(raw) ? raw : Array.isArray(raw?.item) ? raw.item : raw?.item ? [raw.item] : [];
    console.log(`\n### ${op}: HTTP ${res.status}, total ${body?.totalCount ?? '-'} | ${JSON.stringify(j?.response?.header || Object.values(j)[0]?.header || j?.OpenAPI_ServiceResponse?.cmmMsgHeader || {})}`);
    return items;
  } catch {
    console.log(`\n### ${op}: HTTP ${res.status} 비JSON ${text.slice(0, 200)}`);
    return [];
  }
}

const range = { inqryDiv: '1', inqryBgnDt: kst(begin), inqryEndDt: kst(end) };
// 1) 낙찰된 용역 (검색조건)
const won = await call('as/ScsbidInfoService', 'getScsbidListSttusServcPPSSrch', { ...range, bidNtceNm: '공간정보' });
console.log('낙찰 예시:', JSON.stringify(won[0] || null));
// 2) 개찰결과 용역 (검색조건)
const opened = await call('as/ScsbidInfoService', 'getOpengResultListInfoServcPPSSrch', { ...range, bidNtceNm: '공간정보' });
console.log('개찰 예시:', JSON.stringify(opened[0] || null));
// 3) 개찰완료 순위 (공고 하나)
const target = won[0] || opened[0];
if (target) {
  const ranks = await call('as/ScsbidInfoService', 'getOpengResultListInfoOpengCompt', { bidNtceNo: target.bidNtceNo, bidNtceOrd: target.bidNtceOrd || '000' });
  console.log('순위 수:', ranks.length, '예시:', JSON.stringify(ranks.slice(0, 3)));
}
// 4) 계약현황 용역 (검색조건, 최근 계약 중 공동계약)
const day = (d) => kst(d).slice(0, 8);
const cont = await call('ao/CntrctInfoService', 'getCntrctInfoListServcPPSSrch', { inqryDiv: '1', inqryBgnDate: day(new Date(end.getTime() - 30 * 86400e3)), inqryEndDate: day(end), cntrctNm: '공간정보' });
const joint = cont.filter((c) => c.cmmnCntrctYn === 'Y');
console.log('계약 수:', cont.length, '공동계약:', joint.length);
console.log('계약 예시(공동):', JSON.stringify(joint[0] || null));
console.log('계약 예시(단독) corpList:', JSON.stringify((cont.find((c) => c.cmmnCntrctYn !== 'Y') || {}).corpList));
