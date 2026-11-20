// 공고번호 하나로 공고·낙찰을 찾는 조회구분 확인 (일회용)
let key = process.env.DATA_GO_KR_KEY;
if (/%[0-9A-Fa-f]{2}/.test(key)) key = decodeURIComponent(key);
async function call(url, params) {
  const qs = new URLSearchParams({ serviceKey: key, type: 'json', pageNo: '1', numOfRows: '20', ...params });
  const res = await fetch(`${url}?${qs}`);
  const j = await res.json().catch(() => ({}));
  const body = j?.response?.body; const raw = body?.items;
  const items = Array.isArray(raw) ? raw : Array.isArray(raw?.item) ? raw.item : raw?.item ? [raw.item] : [];
  console.log(`### ${url.split('/').pop()} ${JSON.stringify(params)}: total ${body?.totalCount ?? '-'} | ${JSON.stringify(j?.response?.header || Object.values(j)[0]?.header || {})}`);
  return items;
}
const id = 'R26BK01832700';
for (const div of ['1', '2', '3']) {
  const n = await call('https://apis.data.go.kr/1230000/ad/BidPublicInfoService02/getBidPblancListInfoServc02', { inqryDiv: div, bidNtceNo: id });
  if (n.length) { console.log('공고:', JSON.stringify([n[0].bidNtceNm, n[0].presmptPrce, n[0].bidClseDt, n[0].dminsttNm, n[0].cntrctCnclsMthdNm])); break; }
}
for (const div of ['1', '2', '3', '4']) {
  const s = await call('https://apis.data.go.kr/1230000/as/ScsbidInfoService/getScsbidListSttusServcPPSSrch', { inqryDiv: div, bidNtceNo: id });
  if (s.length) { console.log('낙찰:', JSON.stringify([s[0].bidwinnrNm, s[0].sucsfbidAmt, s[0].prtcptCnum])); break; }
}
for (const div of ['1', '2', '3', '4']) {
  const o = await call('https://apis.data.go.kr/1230000/as/ScsbidInfoService/getOpengResultListInfoServcPPSSrch', { inqryDiv: div, bidNtceNo: id });
  if (o.length) { console.log('개찰:', JSON.stringify([o[0].progrsDivCdNm, o[0].opengDt, o[0].prtcptCnum])); break; }
}
// 유찰 목록 조회 모양
const f = await call('https://apis.data.go.kr/1230000/as/ScsbidInfoService/getOpengResultListInfoFailing', { inqryDiv: '1', inqryBgnDt: '202611140000', inqryEndDt: '202611202359' });
console.log('유찰 예시:', JSON.stringify(f[0] || null).slice(0, 600));
