// 새 API 들이 이 키로 열리는지, 응답이 어떤 모양인지 확인하는 일회용 시험.
let key = process.env.DATA_GO_KR_KEY;
if (/%[0-9A-Fa-f]{2}/.test(key)) key = decodeURIComponent(key);
const dart = process.env.DART_API_KEY;
const kst = (d) => { const x = new Date(d.getTime() + 9 * 3600e3); const p = (n) => String(n).padStart(2, '0'); return `${x.getUTCFullYear()}${p(x.getUTCMonth() + 1)}${p(x.getUTCDate())}${p(x.getUTCHours())}${p(x.getUTCMinutes())}`; };
const end = new Date(), begin = new Date(end.getTime() - 6 * 86400e3);
const show = (label, v) => console.log(label, JSON.stringify(v).slice(0, 1400));

async function call(url, params, keyName = 'serviceKey') {
  const qs = new URLSearchParams({ [keyName]: key, type: 'json', pageNo: '1', numOfRows: '20', ...params });
  const res = await fetch(`${url}?${qs}`);
  const text = await res.text();
  try {
    const j = JSON.parse(text);
    const body = j?.response?.body;
    const raw = body?.items;
    const items = Array.isArray(raw) ? raw : Array.isArray(raw?.item) ? raw.item : raw?.item ? [raw.item] : [];
    console.log(`\n### ${url.split('/').pop()} ${JSON.stringify(params).slice(0, 120)}: HTTP ${res.status}, total ${body?.totalCount ?? '-'} | ${JSON.stringify(j?.response?.header || Object.values(j)[0]?.header || j?.OpenAPI_ServiceResponse?.cmmMsgHeader || {})}`);
    return items;
  } catch {
    console.log(`\n### ${url.split('/').pop()}: HTTP ${res.status} 비JSON ${text.slice(0, 200)}`);
    return [];
  }
}
const SB = 'https://apis.data.go.kr/1230000/as/ScsbidInfoService';
const CT = 'https://apis.data.go.kr/1230000/ao/CntrctInfoService';
const US = 'https://apis.data.go.kr/1230000/ao/UsrInfoService02';
const NP = 'https://apis.data.go.kr/B552015/NpsBplcInfoInqireServiceV2';
const range = { inqryDiv: '1', inqryBgnDt: kst(begin), inqryEndDt: kst(end) };

// 1) 낙찰정보
const won = await call(`${SB}/getScsbidListSttusServcPPSSrch`, { ...range, bidNtceNm: '정보', indstrytyCd: '1468' });
show('낙찰 예시:', won[0] || null);
const opened = await call(`${SB}/getOpengResultListInfoServcPPSSrch`, { ...range, bidNtceNm: '정보', indstrytyCd: '1468' });
show('개찰 예시:', opened.slice(0, 2));
show('개찰 진행구분 종류:', [...new Set(opened.map((o) => o.progrsDivCdNm))]);
const target = won[0] || opened.find((o) => Number(o.prtcptCnum) > 1) || opened[0];
if (target) {
  const ranks = await call(`${SB}/getOpengResultListInfoOpengCompt`, { bidNtceNo: target.bidNtceNo, bidNtceOrd: target.bidNtceOrd || '000' });
  show('순위:', ranks.slice(0, 4));
  // 2) 같은 공고의 계약 — 공고번호로 찾기 (조회구분 바꿔 가며)
  for (const div of ['1', '2', '3', '4']) {
    const c = await call(`${CT}/getCntrctInfoListServcPPSSrch`, { inqryDiv: div, ntceNo: target.bidNtceNo });
    if (c.length) { show(`계약(조회구분 ${div}):`, c.map((x) => [x.cntrctNm, x.ntceNo, x.corpList])); break; }
  }
}
// 3) 사용자정보 — 업체 기본정보
const bizno = won[0]?.bidwinnrBizno || '3178123292';
for (const div of ['1', '2', '3']) {
  const u = await call(`${US}/getPrcrmntCorpBasicInfo02`, { inqryDiv: div, bizno });
  if (u.length) { show(`업체(조회구분 ${div}):`, u[0]); break; }
}
// 4) 국민연금 — 사업장 검색 후 상세
const nps = await call(`${NP}/getBassInfoSearchV2`, { wkplNm: '케이정보기술', bzowrRgstNo: '317812', dataType: 'json' });
show('국민연금 사업장:', nps.slice(0, 3));
if (nps[0]) {
  const d = await call(`${NP}/getDetailInfoSearchV2`, { seq: nps[0].seq, dataType: 'json' });
  show('국민연금 상세:', d[0] || null);
  const ym = kst(new Date(end.getTime() - 40 * 86400e3)).slice(0, 6);
  const p = await call(`${NP}/getPdAcctoSttusInfoSearchV2`, { seq: nps[0].seq, dataCrtYm: ym, dataType: 'json' });
  show(`국민연금 ${ym} 증감:`, p[0] || null);
}
// 5) DART — 고유번호 목록(zip)과 회사 개황
if (dart) {
  const r = await fetch(`https://opendart.fss.or.kr/api/corpCode.xml?crtfc_key=${dart}`);
  const buf = Buffer.from(await r.arrayBuffer());
  console.log('\n### DART corpCode:', r.status, r.headers.get('content-type'), buf.length, 'bytes', buf.subarray(0, 2).toString() === 'PK' ? 'ZIP' : buf.subarray(0, 200).toString());
  const c = await (await fetch(`https://opendart.fss.or.kr/api/company.json?crtfc_key=${dart}&corp_code=00126380`)).json();
  show('DART 회사 개황(삼성전자):', { status: c.status, message: c.message, corp_name: c.corp_name, bizr_no: c.bizr_no });
  const f = await (await fetch(`https://opendart.fss.or.kr/api/fnlttSinglAcnt.json?crtfc_key=${dart}&corp_code=00126380&bsns_year=2025&reprt_code=11011`)).json();
  show('DART 주요계정:', { status: f.status, message: f.message, first: (f.list || []).slice(0, 3).map((x) => [x.fs_div, x.account_nm, x.thstrm_amount]) });
} else console.log('\n### DART: 키 없음');
