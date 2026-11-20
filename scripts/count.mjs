// 수집 범위를 정하려고 데이터 양을 재는 일회용 스크립트.
import { config, API, kstStamp, callApi } from './lib.mjs';
const DAY = 86400e3, now = Date.now();
const win = (k) => ({ inqryDiv: '1', inqryBgnDt: kstStamp(new Date(now - (k + 1) * 6 * DAY)), inqryEndDt: kstStamp(new Date(now - k * 6 * DAY)), numOfRows: '1', pageNo: '1' });
const total = async (op, p) => (await callApi(API.scsbid, op, p)).total;
for (const k of [0, 10, 30]) {
  const sw = await total('getOpengResultListInfoServcPPSSrch', { ...win(k), indstrytyCd: '1468' });
  const all = await total('getOpengResultListInfoServcPPSSrch', win(k));
  let kw = 0;
  for (const w of config.keywords) kw += await total('getOpengResultListInfoServcPPSSrch', { ...win(k), indstrytyCd: '1468', bidNtceNm: w });
  console.log(`${k * 6}~${(k + 1) * 6}일 전 개찰: 용역 전체 ${all}, 소프트웨어업종 ${sw}, 우리 키워드 합 ${kw}`);
}
for (const w of ['정보시스템', '유지관리', '유지보수', '플랫폼', '시스템 구축', '데이터베이스', 'DB', '포털', '홈페이지', '고도화', '정보화', '전산']) {
  console.log(`  추가 후보 "${w}": ${await total('getOpengResultListInfoServcPPSSrch', { ...win(0), indstrytyCd: '1468', bidNtceNm: w })}`);
}
