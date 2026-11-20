// 발췌 규칙 시험.  node scripts/docs.test.mjs
import assert from 'node:assert/strict';
import { conditions, parse, hwpParaText } from './docs.mjs';

// HWP 문단 레코드: 글자 + 탭(9, 8글자 자리) + 확장 제어문자(11, 8글자 자리) + 문단 끝(13)
const u16 = (...codes) => Buffer.from(Uint16Array.from(codes).buffer);
const rec = Buffer.concat([
  Buffer.from('사업', 'utf16le'), u16(9, 0, 0, 0, 0, 0, 0, 9),
  Buffer.from('범위', 'utf16le'), u16(11, 0x6c74, 0x6274, 0, 0, 0, 0, 11),
  Buffer.from('끝', 'utf16le'), u16(13),
]);
assert.equal(hwpParaText(rec), '사업 범위끝\n');

const region = (t) => conditions(t).regionReq;

// 본문에 적힌 소재지 제한
assert.deepEqual(region('입찰공고일 180일 전부터 주된 영업소 소재지가 경기도 내 업체로 입찰일까지 자격을 유지한 업체'), ['경기']);
assert.deepEqual(region('법인등기부등본상 본점소재지(개인사업자인 경우에는 사업자등록증에 기재된 사업장의 소재지)가 경상남도인 업체'), ['경남']);
assert.deepEqual(region('서울특별시 관내 업체로서 소프트웨어사업자로 등록한 자'), ['서울']);
// 지역 제한이 아닌 문구는 잡지 않는다
assert.deepEqual(region('공동수급체의 명칭, 사업소의 소재지, 대표자는 다음과 같다. 1. 명 칭 : ○○○ 2. 주사무소소재지 :'), []);
assert.deepEqual(region('분쟁이 있을 경우 관할 법원은 충청남도의 소재지를 관할하는 법원으로 한다.'), []);
assert.deepEqual(region('공동수급체 구성원 중 1인 이상은 주된 영업소 소재지가 경기도 내 업체이어야 함'), []);
assert.equal(conditions('공동수급체 구성원 중 1인 이상은 지역업체를 포함하여야 함').regionDuty, true);

// 직접생산 품목
const d = conditions('직접생산확인증명서【정보시스템개발서비스(8111159901)】및【정보시스템유지관리서비스(8111189901)】를 소지한 업체').direct;
assert.deepEqual(d.map((x) => x.name), ['정보시스템개발서비스', '정보시스템유지관리서비스']);

// 사업 범위 발췌: 목차는 건너뛰고 본문 제목 아래 내용을 가져온다
const text = [
  '목 차', '1. 사업개요 ······ 1', '3. 사업범위 ······ 2',
  '1. 사업개요', '가. 사 업 명 : 시험 사업', '나. 사업기간 : 2027. 1. 1. ~ 12. 31.',
  '2. 추진배경 및 필요성', '가. 데이터 기반 행정 수요가 늘고 있음', '나. 분석 체계 마련 필요',
  '3. 사업범위', '가. 생활인구 분석', '- 월별, 성별, 연령별 생활인구 규모', '나. 관광객 유입 분석',
  '※ 세부 내용은 협의', '조정될 수 있음', '다. 대시보드 구축',
  '4. 기대효과', '가. 행정 신뢰도 향상',
].join('\n');
const p = parse(text);
assert.deepEqual(p.scope, ['가. 생활인구 분석', '- 월별, 성별, 연령별 생활인구 규모', '나. 관광객 유입 분석', '다. 대시보드 구축']);
assert.deepEqual(p.background, ['가. 데이터 기반 행정 수요가 늘고 있음', '나. 분석 체계 마련 필요']);
assert.equal(p.period, '2027. 1. 1. ~ 12. 31.');

// 줄바꿈으로 잘린 글머리 항목은 한 줄로 붙인다
const wrapped = parse(['3. 사업범위', '- 시범 분석과제 결과 공유를 통한 확산 및', '활성화 지원', '- 교육 지원', '4. 기대효과'].join('\n'));
assert.deepEqual(wrapped.scope, ['- 시범 분석과제 결과 공유를 통한 확산 및 활성화 지원', '- 교육 지원']);

const period = (t) => conditions(t).period;
assert.equal(period('나. 사업기간 : 2027. 1. 1. ~ 2027. 12. 31. 다. 사업예산 : 1억'), '2027. 1. 1. ~ 2027. 12. 31.');
assert.equal(period('사업기간 : 2027. 1. 1. ~ 2028. 12. 31.(장기계속계약, 2년) 다. 사업예산'), '2027. 1. 1. ~ 2028. 12. 31.(장기계속계약, 2년)');
assert.equal(period('사업 기간 : 계약일 ~ 2027. 12. 31. 사업 예산'), '계약일 ~ 2027. 12. 31.');
assert.equal(period('나. 용역기간 : 착수일로부터 120일 다. 과업내용'), '착수일로부터 120일');

console.log('모든 시험 통과');
